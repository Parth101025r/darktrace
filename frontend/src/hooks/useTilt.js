import { useRef } from 'react';

const MAX_TILT = 7;

export function useTilt() {
  const ref = useRef(null);

  const onMouseMove = (event) => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const element = event.currentTarget;
    const bounds = element.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width;
    const y = (event.clientY - bounds.top) / bounds.height;

    element.style.setProperty('--rx', `${(0.5 - y) * MAX_TILT}deg`);
    element.style.setProperty('--ry', `${(x - 0.5) * MAX_TILT}deg`);
    element.style.setProperty('--gx', `${x * 100}%`);
    element.style.setProperty('--gy', `${y * 100}%`);
    element.classList.add('is-tilting');
  };

  const onMouseLeave = (event) => {
    const element = event.currentTarget;
    element.style.removeProperty('--rx');
    element.style.removeProperty('--ry');
    element.style.removeProperty('--gx');
    element.style.removeProperty('--gy');
    element.classList.remove('is-tilting');
  };

  return { ref, onMouseMove, onMouseLeave };
}
