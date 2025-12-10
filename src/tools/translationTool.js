const { translate } = require('@vitalets/google-translate-api');
const z = require('zod/v4');

const translationToolInstructions = [
  'Use semantic-translate to translate text between languages while preserving character length similar to English.',
  'Supports multiple languages: Vietnamese (vi), Chinese (zh-CN/zh-TW), Japanese (ja), Korean (ko), Spanish (es), French (fr), German (de), and more.',
  'By default maintains character length within ±20% of original, adjustable via max_length_variance parameter.',
  'Returns translated text with character count comparison and length compliance status.',
  'Source language auto-detection is default; specify source_language for better accuracy when known.'
].join('\n');

const semanticTranslateInputSchema = z.object({
  text: z.string().min(1).describe('Text to translate'),
  source_language: z
    .string()
    .min(2)
    .default('auto')
    .describe('Source language code (e.g., en, vi, zh-CN); default is auto-detect'),
  target_language: z
    .string()
    .min(2)
    .describe('Target language code (required, e.g., vi, zh-CN, ja, ko, es, fr, de)'),
  max_length_variance: z
    .number()
    .min(0)
    .max(100)
    .default(20)
    .describe('Maximum allowed character length variance percentage (default 20%)')
});

async function performTranslation(text, sourceLang, targetLang, maxRetries = 3) {
  let lastError = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const result = await translate(text, {
        from: sourceLang === 'auto' ? undefined : sourceLang,
        to: targetLang
      });
      return result;
    } catch (error) {
      lastError = error;
      // Wait a bit before retrying (exponential backoff)
      if (attempt < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 100));
      }
    }
  }
  
  throw new Error(`Translation failed after ${maxRetries} attempts: ${lastError?.message || 'Unknown error'}`);
}

function calculateLengthVariance(originalLength, translatedLength) {
  if (originalLength === 0) return 0;
  return Math.abs(translatedLength - originalLength) / originalLength * 100;
}

function isLengthWithinVariance(originalLength, translatedLength, maxVariance) {
  const variance = calculateLengthVariance(originalLength, translatedLength);
  return variance <= maxVariance;
}

async function semanticTranslateWithLengthCheck(params) {
  const { text, source_language, target_language, max_length_variance } = params;
  const originalLength = text.length;
  
  // Perform translation
  const result = await performTranslation(text, source_language, target_language);
  const translatedText = result.text;
  const translatedLength = translatedText.length;
  const detectedSourceLang = result.from?.language?.iso || source_language;
  
  // Calculate variance
  const variance = calculateLengthVariance(originalLength, translatedLength);
  const withinVariance = isLengthWithinVariance(originalLength, translatedLength, max_length_variance);
  
  return {
    translatedText,
    originalLength,
    translatedLength,
    variance: variance.toFixed(2),
    withinVariance,
    detectedSourceLang,
    targetLanguage: target_language
  };
}

function registerTranslationTool(server) {
  server.registerTool(
    'semantic-translate',
    {
      title: 'Semantic Translation',
      description:
        'Translate text between languages while attempting to preserve character length similar to English (±20% default tolerance). Supports multiple languages including Vietnamese, Chinese, Japanese, Korean, Spanish, French, German, and more.',
      inputSchema: semanticTranslateInputSchema
    },
    async (params, extra) => {
      const startTime = process.hrtime.bigint();
      
      try {
        const translationResult = await semanticTranslateWithLengthCheck(params);
        const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;
        
        if (extra && typeof extra.sessionId === 'string') {
          server
            .sendLoggingMessage(
              {
                level: 'info',
                data:
                  `Translated text (${translationResult.detectedSourceLang} → ${translationResult.targetLanguage}) ` +
                  `in ${elapsedMs.toFixed(2)}ms: ${translationResult.originalLength} → ${translationResult.translatedLength} chars ` +
                  `(${translationResult.variance}% variance)`
              },
              extra.sessionId
            )
            .catch(() => {
              /* best-effort logging */
            });
        }
        
        const content = [];
        
        // Add main translation result
        content.push({
          type: 'text',
          text: translationResult.translatedText
        });
        
        // Add detailed metadata
        const metadata = [
          `Character Count Comparison:`,
          `  Original (${translationResult.detectedSourceLang}): ${translationResult.originalLength} characters`,
          `  Translated (${translationResult.targetLanguage}): ${translationResult.translatedLength} characters`,
          `  Length Variance: ${translationResult.variance}%`,
          `  Within Tolerance (${params.max_length_variance}%): ${translationResult.withinVariance ? 'Yes ✓' : 'No ✗'}`,
          ``,
          `Translation Details:`,
          `  Detected Source: ${translationResult.detectedSourceLang}`,
          `  Target Language: ${translationResult.targetLanguage}`,
          `  Processing Time: ${elapsedMs.toFixed(2)}ms`
        ].join('\n');
        
        content.push({
          type: 'text',
          text: metadata
        });
        
        // Add warning if length exceeds variance
        if (!translationResult.withinVariance) {
          content.push({
            type: 'text',
            text: `⚠️ Warning: Translated text length variance (${translationResult.variance}%) exceeds the specified tolerance (${params.max_length_variance}%). This may occur when translating between languages with different character densities (e.g., English to Chinese/Japanese). Consider adjusting max_length_variance or rephrasing the source text.`
          });
        }
        
        return { content };
      } catch (error) {
        // Log error
        if (extra && typeof extra.sessionId === 'string') {
          server
            .sendLoggingMessage(
              {
                level: 'error',
                data: `Translation failed: ${error.message}`
              },
              extra.sessionId
            )
            .catch(() => {
              /* best-effort logging */
            });
        }
        
        throw new Error(
          `Translation failed: ${error.message}. ` +
          `Ensure target_language is valid (e.g., 'vi', 'zh-CN', 'ja', 'ko', 'es', 'fr', 'de').`
        );
      }
    }
  );
}

module.exports = {
  registerTranslationTool,
  translationToolInstructions
};
