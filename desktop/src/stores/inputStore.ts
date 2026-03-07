import { create } from "zustand";
import { resizeImage } from "@/lib/imageResize";

export interface PendingImage {
  id: string;
  file: File;
  dataUrl: string;
  resizedBlob: Blob;
}

export interface PendingAudio {
  id: string;
  blob: Blob;
  duration: number;
  mimeType: string;
}

interface InputStore {
  input: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null> | null;
  pendingImages: PendingImage[];
  pendingAudio: PendingAudio | null;
  isRecording: boolean;

  setInput: (input: string) => void;
  appendToInput: (text: string) => void;
  setTextareaRef: (ref: React.RefObject<HTMLTextAreaElement | null>) => void;
  focusInput: () => void;
  addImages: (files: File[]) => Promise<void>;
  removeImage: (id: string) => void;
  setPendingAudio: (audio: PendingAudio) => void;
  removePendingAudio: () => void;
  clearAttachments: () => void;
  hasAttachments: () => boolean;
  setRecording: (recording: boolean) => void;
}

const MAX_IMAGES = 5;

export const useInputStore = create<InputStore>((set, get) => ({
  input: "",
  textareaRef: null,
  pendingImages: [],
  pendingAudio: null,
  isRecording: false,

  setInput: (input: string) => set({ input }),
  appendToInput: (text: string) => {
    const current = get().input;
    const separator = current && !current.endsWith(" ") ? " " : "";
    set({ input: current + separator + text });
  },
  setTextareaRef: (ref) => set({ textareaRef: ref }),
  focusInput: () => {
    const ref = get().textareaRef;
    ref?.current?.focus();
  },

  addImages: async (files: File[]) => {
    const current = get().pendingImages;
    const remaining = MAX_IMAGES - current.length;
    const toAdd = files.slice(0, remaining);

    const newImages: PendingImage[] = await Promise.all(
      toAdd.map(async (file) => {
        const dataUrl = await readAsDataUrl(file);
        const resizedBlob = await resizeImage(file);
        return {
          id: crypto.randomUUID(),
          file,
          dataUrl,
          resizedBlob,
        };
      }),
    );

    set({ pendingImages: [...get().pendingImages, ...newImages] });
  },

  removeImage: (id: string) => {
    set({ pendingImages: get().pendingImages.filter((img) => img.id !== id) });
  },

  setPendingAudio: (audio: PendingAudio) => set({ pendingAudio: audio }),
  removePendingAudio: () => set({ pendingAudio: null }),

  clearAttachments: () => set({ pendingImages: [], pendingAudio: null }),

  hasAttachments: () => {
    const { pendingImages, pendingAudio } = get();
    return pendingImages.length > 0 || pendingAudio !== null;
  },

  setRecording: (recording: boolean) => set({ isRecording: recording }),
}));

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
