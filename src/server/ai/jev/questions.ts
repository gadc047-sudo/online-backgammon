/**
 * The three Choice questions Jev answers, and nothing else.
 *
 * Choice rather than Noul throughout, including for the cube: the decision
 * panel's contract is choice + probabilities + confidence, and a Noul returns a
 * single probability with no separate confidence. Keeping all three questions
 * the same primitive means one rendering path and one fallback path.
 *
 * Question ids are for this code only — the docs are explicit that they are not
 * sent to the model — so the full meaning lives in `instructions` and
 * `criteria`. Criteria are structured objects rather than sentences because
 * every option here is a computed fact table, not a description someone wrote.
 */

import type { ChoiceQuestion, JsonValue } from '../../typesafe/client';
import type { PlayFacts } from './describe';

export const MOVE_QUESTION_ID = 'best_play';
export const CUBE_OFFER_QUESTION_ID = 'cube_offer';
export const CUBE_RESPONSE_QUESTION_ID = 'cube_response';

/**
 * Cap on options put to the model in one Choice. The API allows 255, but a
 * roll of doubles in a loose position can generate hundreds of legal
 * sequences, most of them near-duplicates; past a couple of dozen the extra
 * options cost tokens and latency without adding a real alternative. Above the
 * cap the existing heuristic prefilters to the best K.
 */
export const MAX_MOVE_OPTIONS = 24;

export function buildMoveQuestion(options: Readonly<Record<string, PlayFacts>>): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: {
      task: 'Choose the strongest play for the side to move in this backgammon position.',
      options_are:
        'Every option is a complete, rules-legal play of the dice rolled this turn, already ' +
        'checked against the rules. Each is described by the position it leaves behind, from ' +
        'the point of view of the side to move.',
      how_to_judge: [
        'Hitting an opposing blot sends it to the bar and costs that side the pips it had ' +
          'already travelled. It is usually strong, but not when the play that hits leaves ' +
          'several of your own checkers exposed.',
        '`opponent_rolls_that_hit_you` is how many of the opponent\'s 36 possible rolls hit at ' +
          'least one of your blots after this play. Lower is safer.',
        '`points_you_hold` and `your_longest_prime` measure how much of the board the opponent ' +
          'has to get past. A prime of four or more points is hard to escape and is worth ' +
          'accepting some risk to build.',
        'A point held in the opponent\'s home board is an anchor: it is where your checkers ' +
          'return to safely after being hit, and it is worth keeping.',
        'When `your_pip_lead` in the state is clearly positive you are winning the race, so ' +
          'prefer the play that reduces contact and runs for home. When it is clearly negative ' +
          'you need contact, so prefer the play that keeps a blocking position and waits for a shot.',
        'Bearing checkers off is progress that cannot be taken back; when the position is a ' +
          'pure race with no contact left, take the play with the lowest `your_pips_after`.',
      ],
      choose: 'Return the single option that leaves the side to move best placed to win the game.',
    },
    criteria: options as unknown as Record<string, JsonValue>,
  };
}

export function buildCubeOfferQuestion(cubeValue: number): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: {
      task:
        'Decide whether the side to move should offer the doubling cube now, before rolling ' +
        'this turn.',
      how_the_cube_works: [
        `Offering raises the stake from ${cubeValue} to ${cubeValue * 2} points.`,
        'The opponent then either takes — the cube moves to them at the new value, they alone ' +
          'may double next, and play continues — or passes, conceding immediately at ' +
          `${cubeValue} point${cubeValue === 1 ? '' : 's'}.`,
      ],
      how_to_judge: [
        'Double when clearly ahead but not yet winning outright: roughly a 65% to 85% chance to ' +
          'win. That is the band where the opponent still has to take and you gain from the ' +
          'higher stake.',
        'Do not double from an even or worse position. The opponent takes happily and you have ' +
          'doubled the stake against yourself.',
        'Do not double when so far ahead that the opponent would simply pass — you would win ' +
          'one small game instead of playing on for a gammon, which scores double.',
        'Early in a game, from a position close to the opening, there is almost never a double. ' +
          'Look at `race.your_pip_lead`, whether the opponent has checkers on the bar, and how ' +
          'much of a prime you hold before offering.',
        'Holding the cube has value in itself: once you double, the opponent owns it and can ' +
          'double you back later.',
      ],
    },
    criteria: {
      double: {
        action: 'Offer the double now.',
        use_when: 'Clearly ahead, with the opponent still able to justify taking.',
      },
      roll: {
        action: 'Do not double. Roll the dice and play the turn with the cube where it is.',
        use_when:
          'The position is level, unclear, still early, or already so won that a double would ' +
          'just be passed.',
      },
    },
  };
}

export function buildCubeResponseQuestion(cubeValue: number): ChoiceQuestion {
  return {
    type: 'choice',
    instructions: {
      task:
        'The opponent has just offered the doubling cube. Decide whether the side to move ' +
        'should take it or pass.',
      how_the_cube_works: [
        `Passing concedes the game now, losing ${cubeValue} point${cubeValue === 1 ? '' : 's'} and no more.`,
        `Taking accepts the cube at ${cubeValue * 2} points, gives sole ownership of it to the ` +
          'taker, and play continues.',
      ],
      how_to_judge: [
        'Take whenever the chance of winning is roughly 25% or better. Owning the cube is worth ' +
          'extra equity on top of the raw chance, so marginal positions are takes.',
        'Pass when the game is close to lost: trapped behind a long prime with no anchor, far ' +
          'behind in the race with no contact left to create a shot, or on the bar against a ' +
          'nearly closed home board.',
        'Being behind is not by itself a pass. A position that is behind in the race but holds ' +
          'an anchor in the opponent\'s home board still gets a shot at a hit, and is a take.',
      ],
    },
    criteria: {
      take: {
        action: `Take the cube at ${cubeValue * 2} and play on.`,
        use_when: 'There is a real chance of winning, roughly one in four or better.',
      },
      pass: {
        action: `Pass, conceding ${cubeValue} point${cubeValue === 1 ? '' : 's'} now.`,
        use_when: 'The position is close to lost and playing on would risk a bigger loss.',
      },
    },
  };
}
