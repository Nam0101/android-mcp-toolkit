const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const z = require('zod/v4');
const svg2vectordrawable = require('../../vendor/svg2vectordrawable');

const svgToolInstructions = [
  'Use this server to convert SVG into Android VectorDrawable XML (fast, cached).',
  'Call tool convert-svg-to-android-drawable for any SVG→VectorDrawable conversion or option tuning.',
  'Prefer inline SVG via svg; if using svgPath, pass absolute or caller-provided paths only—do not invent paths.',
  'Set outputPath only if a file should be written; otherwise XML is returned inline.',
  'Defaults: floatPrecision=2, fillBlack=false, xmlTag=false, cache=true.',
  'Use fillBlack=true only when the SVG lacks fill and black is desired; set tint only if the caller explicitly requests a tint color.',
  'Do not alter caller SVG content beyond conversion; keep inputs as provided.'
].join('\n');

const convertInputSchema = z
  .object({
    svg: z.string().min(1).describe('Inline SVG markup to convert').optional(),
    svgPath: z.string().min(1).describe('Path to an SVG file to read').optional(),
    outputPath: z
      .string()
      .min(1)
      .describe('Optional output path for generated VectorDrawable XML')
      .optional(),
    floatPrecision: z
      .number()
      .int()
      .min(0)
      .max(6)
      .default(2)
      .describe('Decimal precision when serializing coordinates'),
    fillBlack: z.boolean().default(false).describe('Force fill color black when missing'),
    xmlTag: z.boolean().default(false).describe('Include XML declaration'),
    tint: z.string().min(1).optional().describe('Android tint color (e.g. #FF000000)'),
    cache: z
      .boolean()
      .default(true)
      .describe('Reuse cached result for identical inputs within this process')
  })
  .refine(data => data.svg || data.svgPath, { message: 'Provide either svg or svgPath' });

const conversionCache = new Map();
const MAX_CACHE_SIZE = 32;

function makeCacheKey(svg, options) {
  const hash = createHash('sha256');
  hash.update(svg);
  hash.update(JSON.stringify(options));
  return hash.digest('hex');
}

function getCached(key) {
  const existing = conversionCache.get(key);
  if (!existing) return null;
  conversionCache.delete(key);
  conversionCache.set(key, existing);
  return existing;
}

function setCache(key, value) {
  if (conversionCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = conversionCache.keys().next().value;
    if (oldestKey) {
      conversionCache.delete(oldestKey);
    }
  }
  conversionCache.set(key, value);
}

async function loadSvg(params) {
  if (params.svg) return params.svg;
  const resolvedPath = path.resolve(params.svgPath);
  return fs.readFile(resolvedPath, 'utf8');
}

async function maybeWriteOutput(outputPath, xml) {
  if (!outputPath) return null;
  const resolvedPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
  await fs.writeFile(resolvedPath, xml, 'utf8');
  return resolvedPath;
}

function registerSvgTool(server) {
  server.registerTool(
    'convert-svg-to-android-drawable',
    {
      title: 'SVG to VectorDrawable',
      description:
        'Convert SVG markup or files into Android VectorDrawable XML quickly, optionally writing to disk.',
      inputSchema: convertInputSchema
    },
    async (params, extra) => {
      const svgCode = await loadSvg(params);
      const options = {
        floatPrecision: params.floatPrecision,
        fillBlack: params.fillBlack,
        xmlTag: params.xmlTag,
        tint: params.tint
      };

      const cacheKey = makeCacheKey(svgCode, options);
      const startTime = process.hrtime.bigint();

      let xml = null;
      if (params.cache) {
        xml = getCached(cacheKey);
      }

      if (!xml) {
        xml = await svg2vectordrawable(svgCode, options);
        if (!xml || typeof xml !== 'string') {
          throw new Error('Conversion did not produce XML');
        }
        setCache(cacheKey, xml);
      }

      const savedPath = await maybeWriteOutput(params.outputPath, xml);
      const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

      if (extra && typeof extra.sessionId === 'string') {
        server
          .sendLoggingMessage(
            {
              level: 'info',
              data:
                `Converted SVG in ${elapsedMs.toFixed(2)}ms` +
                (savedPath ? ` (saved to ${savedPath})` : '')
            },
            extra.sessionId
          )
          .catch(() => {
            /* best-effort logging */
          });
      }

      const content = [];
      if (savedPath) {
        content.push({ type: 'text', text: `Saved VectorDrawable to ${savedPath}` });
      }
      content.push({ type: 'text', text: xml });

      return { content };
    }
  );
}

module.exports = {
  registerSvgTool,
  svgToolInstructions
};
