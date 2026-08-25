import html2pdf from 'html2pdf.js';

interface PDFOptions {
  filename?: string;
  margin?: number | [number, number] | [number, number, number, number];
  enableLinks?: boolean;
  jsPDF?: {
    unit?: string;
    format?: any;
    orientation?: 'portrait' | 'landscape';
  };
}

const defaultOptions = {
  margin: [0, 0, -5, 0] as [number, number, number, number], // Margin handled by CSS usually, negative bottom margin fixes the extra empty page issue
  image: { type: 'jpeg' as const, quality: 0.98 },
  html2canvas: {
    scale: 2,
    useCORS: true,
    letterRendering: true,
    scrollY: 0,
    backgroundColor: '#ffffff',
    onclone: (doc: Document) => {
      // Remove all modern color functions from the cloned document to avoid html2canvas crash
      const styles = doc.getElementsByTagName('style');
      for (let i = 0; i < styles.length; i++) {
        const style = styles[i];
        if (
          style.innerHTML.includes('oklch') ||
          style.innerHTML.includes('lab(') ||
          style.innerHTML.includes('color(') ||
          style.innerHTML.includes('hwb(')
        ) {
          style.innerHTML = style.innerHTML.replace(
            /(?:oklch|lab|oklab|color|hwb)\([^)]+\)/g,
            'currentColor'
          );
        }
      }
      const allElements = doc.getElementsByTagName('*');
      for (let i = 0; i < allElements.length; i++) {
        const el = allElements[i] as HTMLElement;
        if (el.style && el.style.cssText) {
          if (
            el.style.cssText.includes('oklch') ||
            el.style.cssText.includes('lab(') ||
            el.style.cssText.includes('color(') ||
            el.style.cssText.includes('hwb(')
          ) {
            el.style.cssText = el.style.cssText.replace(
              /(?:oklch|lab|oklab|color|hwb)\([^)]+\)/g,
              'currentColor'
            );
          }
        }
      }
    },
  },
  jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' as 'portrait' | 'landscape' },
};

/**
 * Generates a PDF from an HTML element and saves it to the user's device.
 */
export const generatePDF = async (
  element: HTMLElement | null,
  options: PDFOptions = {}
): Promise<void> => {
  if (!element) {
    console.error('PDF generation failed: Element not found or null.');
    return;
  }

  const opt = {
    ...defaultOptions,
    filename: options.filename || 'document.pdf',
    margin: options.margin !== undefined ? options.margin : defaultOptions.margin,
    jsPDF: options.jsPDF ? { ...defaultOptions.jsPDF, ...options.jsPDF } : defaultOptions.jsPDF,
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };

  try {
    await html2pdf().from(element).set(opt).save();
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw error;
  }
};

/**
 * Generates a PDF and returns it as a Base64 data URI string.
 * Useful for emailing or uploading.
 */
export const getPDFBase64 = async (
  element: HTMLElement | null,
  options: PDFOptions = {}
): Promise<string> => {
  if (!element) {
    throw new Error('PDF generation failed: Element not found.');
  }

  const opt = {
    ...defaultOptions,
    filename: options.filename || 'document.pdf',
    margin: options.margin !== undefined ? options.margin : defaultOptions.margin,
    jsPDF: options.jsPDF ? { ...defaultOptions.jsPDF, ...options.jsPDF } : defaultOptions.jsPDF,
    pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
  };

  try {
    return await html2pdf().from(element).set(opt).output('datauristring');
  } catch (error) {
    console.error('Error generating PDF base64:', error);
    throw error;
  }
};
