/**
 * Jev's decision policy: turn a position into a TypeSafe Choice, and turn the
 * answer back into something the engine already agreed is legal.
 *
 * The safety property that matters (CLAUDE.md principle 1) is that the model
 * never invents a move. Options are enumerated by the engine's own
 * `legalSequences`, keyed, and handed to the model as criteria; the answer is a
 * key, and a key that is not in the map is treated as a failed call rather than
 * as a move. The worst a bad or hostile answer can do is fall back to the
 * heuristic.
 *
 * Every decision resolves. A TypeSafe failure — no key, timeout, HTTP error,
 * unparseable body, unknown option — returns the existing heuristic's choice
 * marked `source: 'fallback'` with the error attached, so a turn never stalls
 * waiting on the API.
 */

import {
  legalSequences,
  type BoardState,
  type DieValue,
  type GameState,
  type Move,
  type Player,
} from '../../../engine';
import type { JevDecision, JevOption } from '../../../shared/protocol';
import { evaluateBoard } from '../evaluate';
import {
  TypeSafeNotConfiguredError,
  requireChoice,
  type ChoiceAnswer,
  type TypeSafeClient,
} from '../../typesafe/client';
import { chooseSequence, shouldAcceptDouble, shouldOfferDouble } from '../strategy';
import { applySequence, describePlay, describeSequence, type PlayFacts } from './describe';
import {
  CUBE_OFFER_QUESTION_ID,
  CUBE_RESPONSE_QUESTION_ID,
  MAX_MOVE_OPTIONS,
  MOVE_QUESTION_ID,
  buildCubeOfferQuestion,
  buildCubeResponseQuestion,
  buildMoveQuestion,
} from './questions';
import { buildJevState } from './state';

export interface JevMoveOutcome {
  /** The full play for the turn. Hops are applied one at a time by the driver. */
  readonly sequence: readonly Move[];
  readonly decision: Omit<JevDecision, 'id'>;
  readonly error: string | null;
}

export interface JevCubeOutcome {
  readonly act: boolean;
  readonly decision: Omit<JevDecision, 'id'>;
  readonly error: string | null;
}

/** A distinct play, with a stable key for the Choice criteria map. */
interface Candidate {
  readonly key: string;
  readonly sequence: readonly Move[];
  readonly facts: PlayFacts;
}

/**
 * Two different orderings of the same hops reach the same board and are the
 * same decision. Deduping on the resulting position — not on the move list —
 * keeps the option set genuinely distinct, which matters both for the token
 * budget and because a model asked to choose between identical options spreads
 * probability across them for no reason.
 */
function boardKey(board: BoardState): string {
  const points = board.points
    .map((p) => (p.color === null || p.count === 0 ? '.' : `${p.color === 'white' ? 'w' : 'b'}${p.count}`))
    .join('|');
  return `${points}#${board.bar.white},${board.bar.black}#${board.off.white},${board.off.black}`;
}

export function enumerateCandidates(
  turnStartBoard: BoardState,
  player: Player,
  dice: readonly DieValue[],
): { readonly candidates: Candidate[]; readonly totalLegal: number } {
  const sequences = legalSequences(turnStartBoard, player, dice);

  const seen = new Map<string, readonly Move[]>();
  for (const sequence of sequences) {
    const key = boardKey(applySequence(turnStartBoard, player, sequence));
    if (!seen.has(key)) seen.set(key, sequence);
  }

  let distinct = [...seen.values()];
  const totalLegal = distinct.length;

  // Above the cap, rank by the same heuristic that drives the plain computer
  // opponent and keep the best K. The heuristic is the prefilter, never the
  // decision: whatever survives, Jev chooses among.
  if (distinct.length > MAX_MOVE_OPTIONS) {
    distinct = distinct
      .map((sequence) => ({
        sequence,
        score: evaluateBoard(applySequence(turnStartBoard, player, sequence), player),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_MOVE_OPTIONS)
      .map((entry) => entry.sequence);
  }

  const candidates = distinct.map((sequence, index) => ({
    key: `play_${index + 1}`,
    sequence,
    facts: describePlay(turnStartBoard, player, sequence),
  }));

  return { candidates, totalLegal };
}

function optionsFrom(
  answer: ChoiceAnswer,
  labels: ReadonlyMap<string, string>,
): JevOption[] {
  const options: JevOption[] = [];
  for (const [key, label] of labels) {
    options.push({ key, label, probability: answer.probabilities[key] ?? 0 });
  }
  options.sort((a, b) => b.probability - a.probability);
  return options;
}

function fallbackOptions(labels: ReadonlyMap<string, string>, chosen: string): JevOption[] {
  // No distribution exists when the heuristic decided, so the panel shows the
  // options that WERE on the table with no probabilities rather than inventing
  // numbers that look like the model's.
  return [...labels].map(([key, label]) => ({ key, label, probability: key === chosen ? 1 : 0 }));
}

function describeError(error: unknown): string {
  if (error instanceof TypeSafeNotConfiguredError) return error.message;
  if (error instanceof Error) return error.message;
  return 'TypeSafe call failed.';
}

// ------------------------------------------------------------------ the move

export async function decideMove(
  client: TypeSafeClient,
  game: GameState,
  jev: Player,
  stake: number,
): Promise<JevMoveOutcome> {
  const turnStartBoard = game.turnStartBoard ?? game.board;
  const { candidates, totalLegal } = enumerateCandidates(turnStartBoard, jev, game.dice);

  const labels = new Map(candidates.map((c) => [c.key, c.facts.play]));
  const heuristic = chooseSequence(turnStartBoard, jev, game.dice);

  // Nothing to choose between: do not spend a call on a forced play.
  if (candidates.length <= 1) {
    const only = candidates[0];
    const sequence = only?.sequence ?? heuristic;
    const key = only?.key ?? 'play_1';
    const label = only?.facts.play ?? describeSequence(sequence);
    return {
      sequence,
      decision: {
        kind: 'move',
        choice: key,
        choiceLabel: label,
        confidence: 1,
        options: [{ key, label, probability: 1 }],
        consideredOf: Math.max(totalLegal, 1),
        source: 'jev',
        at: Date.now(),
      },
      error: null,
    };
  }

  const criteria: Record<string, PlayFacts> = {};
  for (const candidate of candidates) criteria[candidate.key] = candidate.facts;

  try {
    const response = await client.ask(
      buildJevState({ game, jev, stake, diceRemaining: game.dice }),
      { [MOVE_QUESTION_ID]: buildMoveQuestion(criteria) },
    );
    const answer = requireChoice(response, MOVE_QUESTION_ID);
    const picked = candidates.find((c) => c.key === answer.choice);
    // An option key that is not one of ours is not a move. Fall through.
    if (!picked) throw new Error(`TypeSafe chose "${answer.choice}", which is not a legal play.`);

    return {
      sequence: picked.sequence,
      decision: {
        kind: 'move',
        choice: picked.key,
        choiceLabel: picked.facts.play,
        confidence: answer.confidence,
        options: optionsFrom(answer, labels),
        consideredOf: totalLegal,
        source: 'jev',
        at: Date.now(),
      },
      error: null,
    };
  } catch (error) {
    const chosenKey =
      candidates.find((c) => describeSequence(c.sequence) === describeSequence(heuristic))?.key ??
      candidates[0]?.key ??
      'play_1';
    const chosen = candidates.find((c) => c.key === chosenKey);
    return {
      sequence: chosen?.sequence ?? heuristic,
      decision: {
        kind: 'move',
        choice: chosenKey,
        choiceLabel: chosen?.facts.play ?? describeSequence(heuristic),
        confidence: null,
        options: fallbackOptions(labels, chosenKey),
        consideredOf: totalLegal,
        source: 'fallback',
        at: Date.now(),
      },
      error: describeError(error),
    };
  }
}

// ------------------------------------------------------------------ the cube

const CUBE_OFFER_LABELS: ReadonlyMap<string, string> = new Map([
  ['double', 'Double'],
  ['roll', 'Roll on'],
]);

const CUBE_RESPONSE_LABELS: ReadonlyMap<string, string> = new Map([
  ['take', 'Take'],
  ['pass', 'Pass'],
]);

async function decideBinaryCube(
  client: TypeSafeClient,
  game: GameState,
  jev: Player,
  stake: number,
  spec: {
    readonly kind: 'cube-offer' | 'cube-response';
    readonly questionId: string;
    readonly question: ReturnType<typeof buildCubeOfferQuestion>;
    readonly labels: ReadonlyMap<string, string>;
    readonly actKey: string;
    readonly heuristicActs: boolean;
  },
): Promise<JevCubeOutcome> {
  try {
    const response = await client.ask(buildJevState({ game, jev, stake }), {
      [spec.questionId]: spec.question,
    });
    const answer = requireChoice(response, spec.questionId);
    const label = spec.labels.get(answer.choice);
    if (label === undefined) {
      throw new Error(`TypeSafe chose "${answer.choice}", which is not an option here.`);
    }

    return {
      act: answer.choice === spec.actKey,
      decision: {
        kind: spec.kind,
        choice: answer.choice,
        choiceLabel: label,
        confidence: answer.confidence,
        options: optionsFrom(answer, spec.labels),
        consideredOf: spec.labels.size,
        source: 'jev',
        at: Date.now(),
      },
      error: null,
    };
  } catch (error) {
    const chosenKey = spec.heuristicActs
      ? spec.actKey
      : ([...spec.labels.keys()].find((k) => k !== spec.actKey) ?? spec.actKey);
    return {
      act: spec.heuristicActs,
      decision: {
        kind: spec.kind,
        choice: chosenKey,
        choiceLabel: spec.labels.get(chosenKey) ?? chosenKey,
        confidence: null,
        options: fallbackOptions(spec.labels, chosenKey),
        consideredOf: spec.labels.size,
        source: 'fallback',
        at: Date.now(),
      },
      error: describeError(error),
    };
  }
}

/** Should Jev offer a double before rolling? `act` true means offer. */
export function decideCubeOffer(
  client: TypeSafeClient,
  game: GameState,
  jev: Player,
  stake: number,
): Promise<JevCubeOutcome> {
  return decideBinaryCube(client, game, jev, stake, {
    kind: 'cube-offer',
    questionId: CUBE_OFFER_QUESTION_ID,
    question: buildCubeOfferQuestion(game.cube.value),
    labels: CUBE_OFFER_LABELS,
    actKey: 'double',
    heuristicActs: shouldOfferDouble(game, jev),
  });
}

/** Should Jev take a double just offered to it? `act` true means take. */
export function decideCubeResponse(
  client: TypeSafeClient,
  game: GameState,
  jev: Player,
  stake: number,
): Promise<JevCubeOutcome> {
  return decideBinaryCube(client, game, jev, stake, {
    kind: 'cube-response',
    questionId: CUBE_RESPONSE_QUESTION_ID,
    question: buildCubeResponseQuestion(game.cube.value),
    labels: CUBE_RESPONSE_LABELS,
    actKey: 'take',
    heuristicActs: shouldAcceptDouble(game, jev),
  });
}
