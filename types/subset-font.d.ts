declare module "subset-font" {
  /** 指定した文字だけを含むフォントを作る（harfbuzzベース）。 */
  export default function subsetFont(
    originalFont: Buffer,
    text: string,
    options?: { targetFormat?: "sfnt" | "woff" | "woff2" | "truetype"; preserveNameIds?: number[]; variationAxes?: Record<string, number | { min?: number; max?: number; default?: number }> },
  ): Promise<Buffer>;
}
