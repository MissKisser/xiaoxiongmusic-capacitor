import { readFileSync } from "node:fs";

const source = readFileSync("src/components/Player/PlayerLyric/DefaultLyric.vue", "utf8");

const expectSource = (pattern, message) => {
  if (!pattern.test(source)) {
    throw new Error(message);
  }
};

expectSource(
  /--lrc-right-padding:\s*80px;/,
  "Default lyric layout should keep the desktop right-side reserve as a CSS variable.",
);

expectSource(
  /@media\s*\(max-width:\s*990px\)[\s\S]*--lrc-right-padding:\s*60px;/,
  "Mobile/tablet lyric layout should keep the narrower right-side reserve.",
);

expectSource(
  /--lrc-current-line-extra-start:\s*max\(\s*0px,\s*calc\(var\(--lrc-left-padding,\s*10px\)\s*-\s*var\(--lrc-right-padding\)\)\s*\);/,
  "Current lyric line should be able to expand into the left reserve when needed.",
);

expectSource(
  /--lrc-current-line-extra-end:\s*max\(\s*0px,\s*calc\(var\(--lrc-right-padding\)\s*-\s*var\(--lrc-left-padding,\s*10px\)\)\s*\);/,
  "Current lyric line should be able to expand into the extra right-side reserve.",
);

expectSource(
  /\.lrc-line\s*\{[\s\S]*?width:\s*100%;[\s\S]*?&\.on\s*\{[\s\S]*?width:\s*calc\(\s*100%\s*\+\s*var\(--lrc-current-line-extra-start\)\s*\+\s*var\(--lrc-current-line-extra-end\)\s*\);[\s\S]*?margin-left:\s*calc\(var\(--lrc-current-line-extra-start\)\s*\*\s*-1\);[\s\S]*?margin-right:\s*calc\(var\(--lrc-current-line-extra-end\)\s*\*\s*-1\);/,
  "Only the active lyric line should expand into the larger side reserve.",
);

console.log("Active lyric width style contract passed.");
