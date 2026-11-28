/**
 * Country flags for the flag-filled circuit names. Artwork: the MIT-licensed `flag-icons`
 * package (lipis/flag-icons), bundled locally by Vite (small SVGs inline as data URIs,
 * the larger ones as hashed asset files) — never hotlinked.
 */
import ae from 'flag-icons/flags/4x3/ae.svg?url';
import at from 'flag-icons/flags/4x3/at.svg?url';
import au from 'flag-icons/flags/4x3/au.svg?url';
import az from 'flag-icons/flags/4x3/az.svg?url';
import be from 'flag-icons/flags/4x3/be.svg?url';
import bh from 'flag-icons/flags/4x3/bh.svg?url';
import br from 'flag-icons/flags/4x3/br.svg?url';
import ca from 'flag-icons/flags/4x3/ca.svg?url';
import cn from 'flag-icons/flags/4x3/cn.svg?url';
import es from 'flag-icons/flags/4x3/es.svg?url';
import gb from 'flag-icons/flags/4x3/gb.svg?url';
import hu from 'flag-icons/flags/4x3/hu.svg?url';
import it from 'flag-icons/flags/4x3/it.svg?url';
import jp from 'flag-icons/flags/4x3/jp.svg?url';
import mc from 'flag-icons/flags/4x3/mc.svg?url';
import mx from 'flag-icons/flags/4x3/mx.svg?url';
import nl from 'flag-icons/flags/4x3/nl.svg?url';
import qa from 'flag-icons/flags/4x3/qa.svg?url';
import sa from 'flag-icons/flags/4x3/sa.svg?url';
import sg from 'flag-icons/flags/4x3/sg.svg?url';
import us from 'flag-icons/flags/4x3/us.svg?url';

/** ISO 3166-1 alpha-2 → bundled 4:3 flag URL (only the countries on the 2026 calendar). */
const FLAG_URLS: Record<string, string> = { ae, at, au, az, be, bh, br, ca, cn, es, gb, hu, it, jp, mc, mx, nl, qa, sa, sg, us };

/** Calendar `country` names (as published by OpenF1) → ISO code, plus common aliases. */
const COUNTRY_ISO: Record<string, string> = {
  australia: 'au',
  austria: 'at',
  azerbaijan: 'az',
  bahrain: 'bh',
  belgium: 'be',
  brazil: 'br',
  brasil: 'br',
  canada: 'ca',
  china: 'cn',
  "people's republic of china": 'cn',
  'great britain': 'gb',
  'united kingdom': 'gb',
  uk: 'gb',
  hungary: 'hu',
  italy: 'it',
  japan: 'jp',
  mexico: 'mx',
  monaco: 'mc',
  netherlands: 'nl',
  'the netherlands': 'nl',
  qatar: 'qa',
  'saudi arabia': 'sa',
  singapore: 'sg',
  spain: 'es',
  'united arab emirates': 'ae',
  uae: 'ae',
  'abu dhabi': 'ae',
  'united states': 'us',
  'united states of america': 'us',
  usa: 'us',
};

export function countryIso(country: string | null | undefined): string | null {
  if (!country) return null;
  return COUNTRY_ISO[country.trim().toLowerCase()] ?? null;
}

/**
 * The flag-icons SVGs have a 4:3 viewBox with the default `xMidYMid meet`, so as a CSS
 * background stretched over a wide word they would letterbox. The SVG view fragment
 * switches them to `preserveAspectRatio="none"`, so the whole flag spans the whole word.
 */
const STRETCH = '#svgView(preserveAspectRatio(none))';

export function flagUrl(country: string | null | undefined): string | null {
  const iso = countryIso(country);
  const url = iso ? FLAG_URLS[iso] : undefined;
  return url ? url + STRETCH : null;
}

/**
 * Flags that are mostly white / very light. Their letters get a slightly heavier ink
 * keyline and a faint shade so the white parts never melt into cream paper.
 */
export const LIGHT_FLAGS = new Set(['jp', 'ca', 'mc', 'it', 'at', 'sg', 'gb', 'bh', 'hu', 'mx', 'qa', 'sa']);
