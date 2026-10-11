import { useEffect, useState } from 'react';

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@#$%&';

export default function ScrambleText({ text = '', duration = 700 }) {
  const [display, setDisplay] = useState(text);

  useEffect(() => {
    if (duration <= 0 || !text) {
      setDisplay(text);
      return undefined;
    }

    let frame;
    const startedAt = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const revealed = Math.floor(progress * text.length);
      const next = Array.from(text, (character, index) => {
        if (index < revealed || /\s/.test(character)) return character;
        return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
      }).join('');

      setDisplay(progress === 1 ? text : next);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [duration, text]);

  return <span role="text" aria-label={text}>{display}</span>;
}
