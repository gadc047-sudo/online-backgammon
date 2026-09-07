/**
 * The dice are the one piece of UI a player cannot play without reading, so
 * the markup that presents them is pinned here.
 *
 * `createElement` rather than JSX because vitest only collects `*.test.ts`
 * (see vitest.config.ts) and this needs no DOM — `renderToStaticMarkup` is
 * enough to assert the double treatment is present and the plain roll is not
 * carrying chrome it should not have.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { applyMove, applyRoll, createGame, legalMovesNow } from '../engine/game';
import type { DieValue, GameState, Move } from '../engine/types';
import { DiceRow } from './components/Dice';
import { diceFaces } from './util';

function rolled(roll: readonly [DieValue, DieValue], moves = 0): GameState {
  let state = applyRoll({ ...createGame(), phase: 'awaiting-roll', turn: 'white' }, roll);
  for (let i = 0; i < moves; i += 1) {
    const move = legalMovesNow(state)[0];
    expect(move).toBeDefined();
    state = applyMove(state, move as Move);
  }
  return state;
}

function markup(state: GameState): string {
  return renderToStaticMarkup(
    createElement(DiceRow, { faces: diceFaces(state), owner: state.turn, size: 'lg' }),
  );
}

describe('DiceRow', () => {
  it('renders four dice for a double, badged and counted', () => {
    const html = markup(rolled([2, 2]));
    expect(html).toContain('dice-tray--double');
    expect(html).toContain('Double 2s');
    expect(html).toContain('4 moves');
    expect(html).toContain('4 of 4 left');
    expect(html.match(/class="die /g)).toHaveLength(4);
  });

  it('counts a double down as it is spent and never hides a played die', () => {
    const html = markup(rolled([2, 2], 2));
    expect(html).toContain('2 of 4 left');
    expect(html.match(/class="die /g)).toHaveLength(4);
    expect(html.match(/die--spent/g)).toHaveLength(2);
  });

  it('leaves a plain roll free of the doubles chrome', () => {
    const html = markup(rolled([5, 2]));
    expect(html).toContain('dice-tray');
    expect(html).not.toContain('dice-tray--double');
    expect(html).not.toContain('dice-tray__badge');
    expect(html).not.toContain('Double');
    expect(html.match(/class="die /g)).toHaveLength(2);
  });

  it('describes the whole roll in one label instead of four', () => {
    const html = markup(rolled([6, 6], 1));
    expect(html).toContain(
      'aria-label="Double 6s — four moves, three of four still to play."',
    );
    // The individual dice are decorative once the tray has said it all.
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders nothing before a roll exists', () => {
    const html = renderToStaticMarkup(
      createElement(DiceRow, { faces: [], owner: 'white' as const }),
    );
    expect(html).toBe('');
  });
});
