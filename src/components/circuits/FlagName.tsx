import type { CSSProperties, ElementType } from 'react';
import { countryIso, flagUrl, LIGHT_FLAGS } from './flags';
import './flagName.css';

/**
 * A race / country name with the country's flag as the letter fill: heavy condensed display
 * type, an ink keyline + hard drop behind it and a glossy highlight on top. The visible text
 * is real text (the keyline copy is aria-hidden), so it stays selectable and screen-readable.
 * Countries without a bundled flag fall back to a solid pop-blue fill.
 */
export default function FlagName({
  country,
  text,
  as: Tag = 'span',
  className = '',
  drop,
  id,
}: {
  country: string;
  text: string;
  as?: ElementType;
  className?: string;
  /** colour of the hard drop shadow (defaults to ink) */
  drop?: string;
  id?: string;
}) {
  const url = flagUrl(country);
  const iso = countryIso(country);
  const style = {
    ...(url ? { '--fn-flag': `url("${url}")` } : {}),
    ...(drop ? { '--fn-drop': drop } : {}),
  } as CSSProperties;
  return (
    <Tag id={id} className={`flag-name ${iso && LIGHT_FLAGS.has(iso) ? 'fn-light' : ''} ${className}`} style={style}>
      <span className="fn-key" aria-hidden="true">
        {text}
      </span>
      <span className="fn-fill">{text}</span>
    </Tag>
  );
}
