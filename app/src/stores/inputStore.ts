import { create } from "zustand";

interface InputStore {
  input: string;
  textareaRef: React.RefObject<HTMLTextAreaElement | null> | null;
  setInput: (input: string) => void;
  appendToInput: (text: string) => void;
  setTextareaRef: (ref: React.RefObject<HTMLTextAreaElement | null>) => void;
  focusInput: () => void;
}

export const useInputStore = create<InputStore>((set, get) => ({
  input: "",
  textareaRef: null,
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
}));
