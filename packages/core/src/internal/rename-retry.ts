import * as fs from "node:fs/promises";

// Windows: antivirus real-time scanning holds handles on freshly written files for a moment,
// so the swap-in rename fails EPERM/EBUSY and would crash first launch; back off and retry.
export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code !== "EPERM" && code !== "EBUSY") || attempt >= 5) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}