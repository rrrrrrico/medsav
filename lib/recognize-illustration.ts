import { rowsFromOcrLines, type OcrWord } from "@/lib/illustration-ocr";
import type { IllustrationParseResult } from "@/lib/illustration";

type TesseractWorker = {
  recognize: (
    image: string | File | Blob,
    options?: object,
    output?: object
  ) => Promise<{ data: { blocks?: OcrBlock[] } }>;
  setParameters: (params: Record<string, string>) => Promise<unknown>;
  terminate: () => Promise<unknown>;
};

type OcrBlock = {
  paragraphs?: { lines?: { words?: { text: string; bbox: { x0: number; x1: number } }[] }[] }[];
};

let workerPromise: Promise<TesseractWorker> | null = null;
let onProgress: ((progress: number) => void) | null = null;

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import("tesseract.js");
      const worker = await createWorker("eng", 1, {
        logger: (message) => {
          if (message.status === "recognizing text") onProgress?.(message.progress);
        },
      });
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK });
      return worker as TesseractWorker;
    })();
  }
  return workerPromise;
}

export async function recognizeIllustration(
  image: string | File | Blob,
  progress?: (value: number) => void
): Promise<IllustrationParseResult> {
  onProgress = progress ?? null;
  try {
    const worker = await getWorker();
    progress?.(0);
    const { data } = await worker.recognize(image, {}, { text: false, blocks: true });
    const lines: OcrWord[][] = [];
    for (const block of data.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const line of paragraph.lines || []) {
          const words = (line.words || [])
            .filter((word) => word.text.trim())
            .map((word) => ({
              text: word.text,
              x: (word.bbox.x0 + word.bbox.x1) / 2,
            }));
          if (words.length) lines.push(words);
        }
      }
    }
    const result = rowsFromOcrLines(lines);
    if (!result.rows.length) {
      throw new Error("No table rows recognized");
    }
    return result;
  } finally {
    onProgress = null;
  }
}
