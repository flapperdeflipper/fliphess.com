import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";
import puppeteer from "puppeteer";

const outDir = "public";

mkdirSync(outDir, { recursive: true });

const cvs = [
  { src: "cv/cv-en.md", slug: "cv",    lang: "en", other: { slug: "cv-nl", label: "Nederlands" } },
  { src: "cv/cv-nl.md", slug: "cv-nl", lang: "nl", other: { slug: "cv",    label: "English" } },
];

const pageWidthPx = Math.round((210 / 25.4) * 96);
const paddingPx = 48;

// Palette is a single accent on warm paper. Every contrast pair below clears WCAG AA
// (4.5:1) in normal vision, in protanopia/deuteranopia/tritanopia simulation, and in
// greyscale, so colour never carries meaning on its own: section rules pair with a
// weight change, chips pair with a border, links keep their underline.
const css = `
  :root {
    color-scheme: light;
    --paper: #fdfaf4;
    --ink: #1f1c17;
    --muted: #5b564c;
    --accent: #0f5f66;
    --chip-ink: #0b4d53;
    --chip-bg: #e7f0f0;
    --chip-border: #b9d4d6;
    --label-bg: #f3efe6;
    --rule: #e2ddd0;
    --rule-soft: #ece8dc;
  }
  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: ${paddingPx}px;
    font-family: -apple-system, "Helvetica Neue", Arial, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    color: var(--ink);
    background: var(--paper);
  }

  h1 { font-size: 28px; margin: 0 0 2px; letter-spacing: -0.2px; }
  h1 img {
    height: 64px;
    width: 64px;
    border-radius: 50%;
    vertical-align: middle;
    margin-right: 12px;
    border: 2px solid var(--accent);
  }
  h2 {
    font-size: 20px;
    margin: 30px 0 8px;
    padding-bottom: 5px;
    color: var(--accent);
    border-bottom: 2px solid var(--accent);
  }
  h3 { font-size: 15px; margin: 20px 0 6px; }

  /* The role line under the name: "> ### Platform Engineer" in the markdown. */
  blockquote { margin: 6px 0 10px; border: 0; padding: 0; }
  blockquote h3 {
    margin: 0;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
    color: var(--accent);
  }

  p em { color: var(--muted); }
  a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }

  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    margin: 12px 0;
    border: 1px solid var(--rule);
    border-radius: 8px;
    overflow: hidden;
  }
  th, td { text-align: left; padding: 7px 12px; vertical-align: top; border-bottom: 1px solid var(--rule-soft); }
  tr:last-child td { border-bottom: 0; }
  td:first-child {
    width: 160px;
    font-weight: 600;
    color: var(--muted);
    background: var(--label-bg);
    border-right: 1px solid var(--rule-soft);
    white-space: nowrap;
  }
  thead { display: none; }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--chip-ink);
    background: var(--chip-bg);
    border: 1px solid var(--chip-border);
    padding: 1px 7px;
    border-radius: 10px;
    font-size: 12px;
    white-space: nowrap;
  }

  ul { margin: 6px 0; padding-left: 20px; }
  li { margin: 3px 0; }
  li::marker { color: var(--accent); }

  .downloads {
    font-size: 12px;
    color: var(--muted);
    margin: 0 0 20px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
  }
  .downloads a { font-weight: 600; }
`;

// Web only: the PDF renders with the print media type and a light colour scheme.
const darkCss = `
  :root { color-scheme: light dark; }

  @media (prefers-color-scheme: dark) {
    :root {
      --paper: #17160f;
      --ink: #e9e3d7;
      --muted: #a9a293;
      --accent: #6ec3ca;
      --chip-ink: #8ed4da;
      --chip-bg: #1c2624;
      --chip-border: #2f4a4c;
      --label-bg: #201e16;
      --rule: #322f24;
      --rule-soft: #272419;
    }
  }
`;

function downloadsBar(cv) {
  const words = cv.lang === "nl"
    ? { intro: "Download dit cv als", md: "Markdown" }
    : { intro: "Download this CV as", md: "Markdown" };
  return `<p class="downloads">${words.intro} `
    + `<a href="${cv.slug}.pdf">PDF</a> · `
    + `<a href="${cv.slug}.md">${words.md}</a> · `
    + `<a href="${cv.other.slug}.html">${cv.other.label}</a></p>`;
}

function renderPage(cv, bodyHtml, forWeb) {
  return `
<!doctype html>
<html lang="${cv.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CV — Flip Hess</title>
<style>${css}${forWeb ? darkCss : ""}</style>
</head>
<body>
${forWeb ? downloadsBar(cv) + "\n" : ""}${bodyHtml}</body>
</html>`;

}

function stripInlineMarkup(text) {
  return text
    .replace(/!\[[^\]]*\](\[[^\]]*\]|\([^)]*\))/g, "")      // images
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 <$2>")         // inline links keep the url
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")               // reference links
    .replace(/`([^`]+)`/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+$/, "");
}

// Renders the key/value pipe tables the CV uses as an aligned "Label   value" block.
function renderTable(rows) {
  const cells = rows.map((row) =>
    row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(
      (cell) => stripInlineMarkup(cell.trim()).trim(),
    ),
  );
  const dataRows = cells.filter((row) =>
    !row.every((cell) => cell === "" || /^:?-+:?$/.test(cell)),
  );
  if (dataRows.length === 0) return [];

  const labelWidth = Math.max(...dataRows.map((row) => row[0].length));
  return dataRows.map((row) => `  ${row[0].padEnd(labelWidth)}   ${row.slice(1).join("   ")}`.replace(/\s+$/, ""));
}

function renderPlainText(markdown) {
  // Emphasis is handled here rather than per line, because the CV wraps some bold and
  // italic spans across several source lines. Comments go first so their underscores
  // cannot pair up with the emphasis markers around them.
  const normalized = markdown
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/(^|\s)_([\s\S]+?)_(?=[\s.,:;)]|$)/g, "$1$2");

  const output = [];
  let tableRows = [];

  const flushTable = () => {
    if (tableRows.length === 0) return;
    output.push(...renderTable(tableRows), "");
    tableRows = [];
  };

  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.replace(/^>\s?/, "");

    if (/^\s*\|/.test(line)) {
      tableRows.push(line);
      continue;
    }
    flushTable();

    if (/^\[[^\]]+\]:\s/.test(line)) continue;                          // link definitions

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const [, hashes, rawTitle] = heading;
      const title = stripInlineMarkup(rawTitle).trim();
      if (output.at(-1) !== "" && output.length > 0) output.push("");
      if (hashes.length === 1) output.push(title.toUpperCase(), "=".repeat(title.length));
      else if (hashes.length === 2) output.push(title.toUpperCase(), "-".repeat(title.length));
      else output.push(title);
      output.push("");
      continue;
    }

    const text = stripInlineMarkup(line);
    if (text === "" && output.at(-1) === "") continue;                  // collapse blank runs
    output.push(text);
  }
  flushTable();

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

const browser = await puppeteer.launch({ args: ["--no-sandbox"] });

try {
  for (const cv of cvs) {
    const markdown = readFileSync(cv.src, "utf8");
    const bodyHtml = marked.parse(markdown);

    writeFileSync(join(outDir, `${cv.slug}.md`), markdown);
    writeFileSync(join(outDir, `${cv.slug}.txt`), renderPlainText(markdown));
    writeFileSync(join(outDir, `${cv.slug}.html`), renderPage(cv, bodyHtml, true));

    const page = await browser.newPage();
    await page.setViewport({ width: pageWidthPx, height: 1000 });
    await page.setContent(renderPage(cv, bodyHtml, false), { waitUntil: "networkidle0" });

    const contentHeightPx = await page.evaluate(
      () => document.documentElement.scrollHeight,
    );

    await page.pdf(
        {
           path: join(outDir, `${cv.slug}.pdf`),
           printBackground: true,
           width: `${pageWidthPx}px`,
           height: `${contentHeightPx + 2}px`, // +2px guards against clipping
           margin: { top: 0, right: 0, bottom: 0, left: 0 },
        }
    );
    await page.close();
    console.log(`Built ${cv.slug}: .md .txt .html .pdf (${contentHeightPx}px tall)`);

  }

}
finally {
  await browser.close();
}
