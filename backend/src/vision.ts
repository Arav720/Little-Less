// Looks at the latest camera frame with a vision-capable LLM and describes the product.
import { llm, MODEL } from './llm.js';
import { state, addLog, type Scan } from './state.js';

const PROMPT = `You are helping a shopper in an Indian street market.
Identify the main product the person is holding up or pointing the camera at.
Reply with ONLY a JSON object, no markdown, with these keys:
{
 "item": short product name, e.g. "olive cotton T-shirt",
 "brand": brand if visible or obvious, else null,
 "category": one of clothing | electronics | accessories | food | home | other,
 "color": main colour or null,
 "visible_text": important text on product/label/price tag, else null,
 "quality_notes": short note on visible build/stitching/packaging quality, else null,
 "authenticity_flags": anything suggesting a copy/fake (misspelt logo, missing marks), else null,
 "search_query": 3-6 words to search a catalog, e.g. "plain cotton round neck t-shirt"
}
If no product is clearly visible, set "item" to "nothing clear".`;

export async function scanLatestFrame(): Promise<Scan | { error: string }> {
  const frame = state.latestFrame;
  if (!frame) return { error: 'Camera is off. Ask the user to turn on the camera and point it at the product.' };
  if (Date.now() - frame.at > 15_000) return { error: 'Camera frame is stale. Ask the user to keep the camera on the product.' };

  const res = await llm.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: PROMPT },
          { type: 'image_url', image_url: { url: frame.dataUrl } },
        ],
      },
    ],
  });

  const text = res.choices[0]?.message?.content ?? '';
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { error: 'Could not understand the image. Ask the user to hold the product closer.' };

  try {
    const parsed = JSON.parse(match[0]);
    const scan: Scan = {
      item: String(parsed.item ?? 'unknown'),
      brand: parsed.brand ?? null,
      category: String(parsed.category ?? 'other'),
      color: parsed.color ?? null,
      visible_text: parsed.visible_text ?? null,
      quality_notes: parsed.quality_notes ?? null,
      authenticity_flags: parsed.authenticity_flags ?? null,
      search_query: String(parsed.search_query ?? parsed.item ?? ''),
      at: Date.now(),
    };
    state.lastScan = scan;
    addLog('tool', `Saw: ${scan.item}${scan.brand ? ` (${scan.brand})` : ''}`);
    return scan;
  } catch {
    return { error: 'Could not understand the image. Ask the user to hold the product closer.' };
  }
}
