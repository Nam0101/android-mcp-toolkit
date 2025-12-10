# Semantic Translation Tool - Usage Examples

## Basic Translation

### Vietnamese Translation
```json
{
  "text": "Hello, how are you?",
  "target_language": "vi",
  "max_length_variance": 20
}
```

Expected output:
- Translated text: "Xin chào, bạn khỏe không?"
- Character count comparison
- Variance percentage
- Compliance status

### Spanish Translation
```json
{
  "text": "Good morning!",
  "target_language": "es",
  "max_length_variance": 15
}
```

Expected output:
- Translated text: "¡Buenos días!"
- Character counts: Original 13 → Translated 13
- Variance: ~0%
- Status: Within tolerance ✓

### Chinese Translation
```json
{
  "text": "This is a longer sentence to test character length preservation.",
  "target_language": "zh-CN",
  "max_length_variance": 20
}
```

Note: Character-dense languages like Chinese typically result in shorter translations, which may exceed variance thresholds.

## Advanced Usage

### Explicit Source Language
```json
{
  "text": "Xin chào",
  "source_language": "vi",
  "target_language": "en",
  "max_length_variance": 25
}
```

### Custom Variance Tolerance
```json
{
  "text": "Welcome to our application",
  "target_language": "ja",
  "max_length_variance": 30
}
```

## Supported Languages

Common language codes:
- `vi` - Vietnamese
- `zh-CN` - Chinese (Simplified)
- `zh-TW` - Chinese (Traditional)
- `ja` - Japanese
- `ko` - Korean
- `es` - Spanish
- `fr` - French
- `de` - German
- `it` - Italian
- `pt` - Portuguese
- `ru` - Russian
- `ar` - Arabic
- `hi` - Hindi
- `th` - Thai

## Use Cases

### Android strings.xml Localization
Translate UI strings while maintaining similar character counts to avoid layout issues.

### Internationalization Testing
Test how different languages affect UI layout with length-aware translations.

### Multi-language Content
Generate translations with character count awareness for consistent formatting.

## Notes

- Auto-detection (`source_language: "auto"`) works well for most cases
- Some language pairs naturally have different character densities
- Adjust `max_length_variance` based on your specific requirements
- The tool provides informational metrics; translations always complete regardless of variance
