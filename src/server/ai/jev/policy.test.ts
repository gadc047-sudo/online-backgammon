/**
 * policy.ts — turning a position into a Choice, and an answer back into a play.
 *
 * The property under test throughout is that the model cannot widen what is
 * legal. Options come from the engine's own `legalSequences`, and an answer
 * naming anything else is treated as a failed call, not as a move. Every test
 * here runs against a stub client, so none of them touch the network.
 */
import { describe, expect, it, vi } from 'vitest';

import { applyRoll, createGame, type DieValue, type GameState } from '../../../engine';
import type { JsonValue, Question, SystemOneResponse, TypeSafeClient } from '../../typesafe/client';
import { TypeSafeNotConfiguredError } from '../../typesafe/client';
import { chooseSequence } from '../strategy';
import { describeSequence } from './describe';
import {
  decideCubeOffer,
  decideCubeResponse,
  decideMove,
  enumerateCandidates,
} from './policy';
import { MAX_MOVE_OPTIONS, MOVE_QUESTION_ID } from './questions';

interface Captured {
  state: JsonValue;
  questions: Readonly<Record<string, Question>>;
}

/** Answers with whatever `pick` names, recording what it was asked. */
function stubClient(
  pick: (questions: Readonly<Record<string, Question>>) => string,
  confidence = 0.8,
): TypeSafeClient & { calls: Captured[] } {
  const calls: Captured[] = [];
  return {
    calls,
    configured: true,
    async ask(state, questions): Promise<SystemOneResponse> {
      calls.push({ state, questions });
      const id = Object.keys(questions)[0] ?? MOVE_QUESTION_ID;
      const choice = pick(questions);
      return {
        model: 'jev-test',
        answers: { [id]: { type: 'choice', choice, probabilities: { [choice]: confidence }, confidence } },
      };
    },
  };
}

function failingClient(error: Error): TypeSafeClient {
  return {
    configured: true,
    ask: vi.fn(async () => {
      throw error;
    }),
  };
}

/** Opening position with the given roll already applied, white to play. */
function gameWithRoll(a: DieValue, b: DieValue): GameState {
  const base = createGame();
  return applyRoll({ ...base, phase: 'awaiting-roll', turn: 'white' }, [a, b]);
}

describe('enumerateCandidates', () => {
  it('keys every option and describes it with the play it makes', () => {
    const game = gameWithRoll(6, 5);
    const board = game.turnStartBoard ?? game.board;
    const { candidates } = enumerateCandidates(board, 'white', game.dice);

    expect(candidates.length).toBeGreaterThan(1);
    for (const candidate of candidates) {
      expect(candidate.key).toMatch(/^play_\d+$/);
      expect(candidate.facts.play).toBe(describeSequence(candidate.sequence));
    }
    expect(new Set(candidates.map((c) => c.key)).size).toBe(candidates.length);
  });

  it('collapses different orderings of the same hops into one option', () => {
    const game = gameWithRoll(6, 5);
    const board = game.turnStartBoard ?? game.board;
    const { candidates } = enumerateCandidates(board, 'white', game.dice);

    // Two sequences reaching the same board are the same decision, so no two
    // options may describe an identical resulting position.
    const boards = candidates.map((c) =>
      JSON.stringify(c.sequence.map((m) => [m.from, m.to, m.die, m.hit]).sort()),
    );
    expect(new Set(boards).size).toBe(boards.length);
  });

  it('prefilters to the cap when a roll generates more plays than that', () => {
    // Doubles from the opening explode the sequence count.
    const game = gameWithRoll(3, 3);
    const board = game.turnStartBoard ?? game.board;
    const { candidates, totalLegal } = enumerateCandidates(board, 'white', game.dice);

    expect(totalLegal).toBeGreaterThan(MAX_MOVE_OPTIONS);
    expect(candidates).toHaveLength(MAX_MOVE_OPTIONS);
    // The prefilter is the heuristic's ranking, so its own best play survives.
    const heuristic = describeSequence(chooseSequence(board, 'white', game.dice));
    expect(candidates.map((c) => c.facts.play)).toContain(heuristic);
  });

  it('reports the true legal count even after prefiltering', () => {
    const game = gameWithRoll(3, 3);
    const board = game.turnStartBoard ?? game.board;
    const { totalLegal } = enumerateCandidates(board, 'white', game.dice);
    expect(totalLegal).toBeGreaterThan(MAX_MOVE_OPTIONS);
  });
});

describe('decideMove', () => {
  it('plays exactly the option Jev chose', async () => {
    const game = gameWithRoll(6, 5);
    const board = game.turnStartBoard ?? game.board;
    const { candidates } = enumerateCandidates(board, 'white', game.dice);
    const target = candidates[2];
    if (!target) throw new Error('needed at least three candidates');

    const client = stubClient(() => target.key, 0.91);
    const outcome = await decideMove(client, game, 'white', 25);

    expect(outcome.error).toBeNull();
    expect(outcome.decision.source).toBe('jev');
    expect(outcome.decision.choice).toBe(target.key);
    expect(outcome.decision.choiceLabel).toBe(target.facts.play);
    expect(outcome.decision.confidence).toBeCloseTo(0.91);
    expect(describeSequence(outcome.sequence)).toBe(target.facts.play);
  });

  it('asks one choice question whose criteria are exactly the legal options', async () => {
    const game = gameWithRoll(6, 5);
    const client = stubClient((questions) => {
      const question = questions[MOVE_QUESTION_ID];
      if (!question || question.type !== 'choice') throw new Error('expected a choice question');
      return Object.keys(question.criteria)[0] ?? 'play_1';
    });

    await decideMove(client, game, 'white', 25);

    expect(client.calls).toHaveLength(1);
    const asked = client.calls[0]?.questions[MOVE_QUESTION_ID];
    expect(asked?.type).toBe('choice');

    const board = game.turnStartBoard ?? game.board;
    const { candidates } = enumerateCandidates(board, 'white', game.dice);
    const keys = asked && asked.type === 'choice' ? Object.keys(asked.criteria) : [];
    expect(keys.sort()).toEqual(candidates.map((c) => c.key).sort());
  });

  it('sends the position as structured state, not a rendered board', async () => {
    const game = gameWithRoll(6, 5);
    const client = stubClient((questions) => {
      const question = questions[MOVE_QUESTION_ID];
      return question && question.type === 'choice'
        ? (Object.keys(question.criteria)[0] ?? 'play_1')
        : 'play_1';
    });

    await decideMove(client, game, 'white', 25);

    const state = client.calls[0]?.state as Record<string, JsonValue> | undefined;
    expect(state).toBeDefined();
    expect(state?.you).toMatchObject({ colour: 'white' });
    expect(state?.opponent).toMatchObject({ colour: 'black' });
    expect(state?.race).toMatchObject({ your_pip_count: 167, opponent_pip_count: 167 });
    expect(state?.dice_rolled).toEqual([6, 5]);
    expect(state?.cube).toMatchObject({ value: 1, chips_per_point: 25 });
  });

  it('falls back to the heuristic when Jev names an option that does not exist', async () => {
    const game = gameWithRoll(6, 5);
    const client = stubClient(() => 'play_99999');

    const outcome = await decideMove(client, game, 'white', 25);

    expect(outcome.decision.source).toBe('fallback');
    expect(outcome.decision.confidence).toBeNull();
    expect(outcome.error).toMatch(/not a legal play/);
    const board = game.turnStartBoard ?? game.board;
    expect(describeSequence(outcome.sequence)).toBe(
      describeSequence(chooseSequence(board, 'white', game.dice)),
    );
  });

  it('falls back to the heuristic when the API fails outright', async () => {
    const game = gameWithRoll(6, 5);
    const outcome = await decideMove(failingClient(new Error('boom')), game, 'white', 25);

    expect(outcome.decision.source).toBe('fallback');
    expect(outcome.error).toBe('boom');
    expect(outcome.sequence.length).toBeGreaterThan(0);
  });

  it('falls back with the configuration message when there is no API key', async () => {
    const game = gameWithRoll(6, 5);
    const outcome = await decideMove(
      failingClient(new TypeSafeNotConfiguredError()),
      game,
      'white',
      25,
    );

    expect(outcome.decision.source).toBe('fallback');
    expect(outcome.error).toMatch(/TYPESAFE_API_KEY/);
  });

  it('still shows the options that were on the table when it falls back', async () => {
    const game = gameWithRoll(6, 5);
    const outcome = await decideMove(failingClient(new Error('boom')), game, 'white', 25);

    expect(outcome.decision.options.length).toBeGreaterThan(1);
    const picked = outcome.decision.options.filter((o) => o.probability === 1);
    expect(picked).toHaveLength(1);
    expect(picked[0]?.key).toBe(outcome.decision.choice);
  });

  it('does not spend a call when the play is forced', async () => {
    const client = stubClient(() => 'play_1');
    // Both checkers on the bar against a closed home board: nothing is legal.
    const base = createGame();
    const closed = base.board.points.map((state, index) =>
      index >= 0 && index <= 5 ? { color: 'black' as const, count: 2 } : state,
    );
    const game = applyRoll(
      {
        ...base,
        phase: 'awaiting-roll',
        turn: 'white',
        board: { points: closed, bar: { white: 2, black: 0 }, off: { white: 0, black: 0 } },
      },
      [1, 2],
    );

    const outcome = await decideMove(client, game, 'white', 25);
    expect(client.calls).toHaveLength(0);
    expect(outcome.decision.options).toHaveLength(1);
  });
});

describe('cube decisions', () => {
  const cubeGame = (): GameState => ({
    ...createGame(),
    phase: 'awaiting-roll',
    turn: 'white',
  });

  it('offers the double when Jev chooses it', async () => {
    const outcome = await decideCubeOffer(stubClient(() => 'double', 0.7), cubeGame(), 'white', 25);
    expect(outcome.act).toBe(true);
    expect(outcome.decision.kind).toBe('cube-offer');
    expect(outcome.decision.choiceLabel).toBe('Double');
    expect(outcome.decision.confidence).toBeCloseTo(0.7);
  });

  it('rolls on when Jev declines', async () => {
    const outcome = await decideCubeOffer(stubClient(() => 'roll'), cubeGame(), 'white', 25);
    expect(outcome.act).toBe(false);
    expect(outcome.decision.choiceLabel).toBe('Roll on');
  });

  it('takes a double when Jev chooses take', async () => {
    const game: GameState = { ...cubeGame(), phase: 'cube-offered', cubeOfferedBy: 'black' };
    const outcome = await decideCubeResponse(stubClient(() => 'take'), game, 'white', 25);
    expect(outcome.act).toBe(true);
    expect(outcome.decision.kind).toBe('cube-response');
    expect(outcome.decision.choiceLabel).toBe('Take');
  });

  it('passes when Jev chooses pass', async () => {
    const game: GameState = { ...cubeGame(), phase: 'cube-offered', cubeOfferedBy: 'black' };
    const outcome = await decideCubeResponse(stubClient(() => 'pass'), game, 'white', 25);
    expect(outcome.act).toBe(false);
    expect(outcome.decision.choiceLabel).toBe('Pass');
  });

  it('falls back to the heuristic take on an API failure', async () => {
    const game: GameState = { ...cubeGame(), phase: 'cube-offered', cubeOfferedBy: 'black' };
    const outcome = await decideCubeResponse(failingClient(new Error('down')), game, 'white', 25);

    // The opening position is level, so the heuristic takes.
    expect(outcome.act).toBe(true);
    expect(outcome.decision.source).toBe('fallback');
    expect(outcome.decision.choice).toBe('take');
    expect(outcome.error).toBe('down');
  });

  it('rejects an option key that is not take or pass', async () => {
    const game: GameState = { ...cubeGame(), phase: 'cube-offered', cubeOfferedBy: 'black' };
    const outcome = await decideCubeResponse(stubClient(() => 'beaver'), game, 'white', 25);
    expect(outcome.decision.source).toBe('fallback');
    expect(outcome.error).toMatch(/not an option/);
  });
});
