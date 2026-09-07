import { useEffect, useRef } from 'react';

import { nextCubeValue } from '../../engine/cube';
import type { CubeState } from '../../engine/types';
import { plural } from '../util';

interface CubeOfferModalProps {
  readonly cube: CubeState;
  readonly stake: number;
  readonly offererName: string;
  readonly onTake: () => void;
  readonly onPass: () => void;
}

/**
 * A double interrupts everything, cannot be deferred, and changes what the game
 * is worth. That is the one case a modal is the honest control: the decision
 * genuinely blocks play, so the interface should too.
 */
export function CubeOfferModal(props: CubeOfferModalProps): JSX.Element {
  const { cube, stake, offererName, onTake, onPass } = props;
  const taken = nextCubeValue(cube.value);
  const costOfPassing = stake * cube.value;
  const takeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    takeRef.current?.focus();
  }, []);

  return (
    <div className="modal-scrim" role="presentation">
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="cube-offer-title">
        <span className="modal__cube" aria-hidden="true">
          {taken}
        </span>
        <h2 className="modal__title" id="cube-offer-title">
          {offererName} doubled
        </h2>
        <p className="modal__body">
          Take it and the cube moves to {taken}, on your side — from then on only you may double
          again. Drop it and the game ends now.
        </p>
        <div className="modal__choices">
          <button type="button" className="btn btn--primary" ref={takeRef} onClick={onTake}>
            <span className="btn__main">Take at {taken}</span>
            <span className="btn__sub">Game becomes worth {stake * taken} chips, more on a gammon</span>
          </button>
          <button type="button" className="btn btn--outline" onClick={onPass}>
            <span className="btn__main">Drop</span>
            <span className="btn__sub">
              {offererName} wins {cube.value} {plural(cube.value, 'point', 'points')}, {costOfPassing}{' '}
              chips
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
