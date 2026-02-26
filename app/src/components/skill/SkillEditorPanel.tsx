import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown, type MarkdownStorage } from "tiptap-markdown";
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Save,
  FileCode,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface SkillEditorPanelProps {
  content: string;
  onChange: (content: string) => void;
  readOnly?: boolean;
  onSave?: () => void;
  hasUnsavedChanges?: boolean;
  isSaving?: boolean;
}

function getMarkdownFromEditor(editor: ReturnType<typeof useEditor>): string {
  if (!editor) return "";
  const storage = editor.storage as { markdown?: MarkdownStorage };
  return storage.markdown?.getMarkdown() ?? "";
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
}

function ToolbarButton({ onClick, isActive, disabled, children, title }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "p-1.5 rounded hover:bg-accent transition-colors",
        isActive && "bg-accent text-accent-foreground",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

export function SkillEditorPanel({
  content,
  onChange,
  readOnly = false,
  onSave,
  hasUnsavedChanges = false,
  isSaving = false,
}: SkillEditorPanelProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown,
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const storage = editor.storage as { markdown?: MarkdownStorage };
      const markdown = storage.markdown?.getMarkdown() ?? "";
      onChange(markdown);
    },
    editorProps: {
      attributes: {
        class: "prose prose-sm dark:prose-invert max-w-none focus:outline-none min-h-[300px] p-4",
      },
    },
  });

  // Update editor content when prop changes
  useEffect(() => {
    if (editor && content !== getMarkdownFromEditor(editor)) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  // Update editable state when readOnly changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [readOnly, editor]);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-2 py-1.5 border-b border-border">
        <div className="flex items-center gap-0.5">
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
            isActive={editor?.isActive("heading", { level: 1 })}
            disabled={readOnly}
            title="Heading 1"
          >
            <Heading1 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
            isActive={editor?.isActive("heading", { level: 2 })}
            disabled={readOnly}
            title="Heading 2"
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
            isActive={editor?.isActive("heading", { level: 3 })}
            disabled={readOnly}
            title="Heading 3"
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-5 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleBold().run()}
            isActive={editor?.isActive("bold")}
            disabled={readOnly}
            title="Bold"
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleItalic().run()}
            isActive={editor?.isActive("italic")}
            disabled={readOnly}
            title="Italic"
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-5 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
            isActive={editor?.isActive("bulletList")}
            disabled={readOnly}
            title="Bullet List"
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
            isActive={editor?.isActive("orderedList")}
            disabled={readOnly}
            title="Numbered List"
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>

          <div className="w-px h-5 bg-border mx-1" />

          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleCode().run()}
            isActive={editor?.isActive("code")}
            disabled={readOnly}
            title="Inline Code"
          >
            <Code className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
            isActive={editor?.isActive("codeBlock")}
            disabled={readOnly}
            title="Code Block"
          >
            <FileCode className="h-4 w-4" />
          </ToolbarButton>
        </div>

        {onSave && !readOnly && (
          <Button
            variant="outline"
            size="sm"
            onClick={onSave}
            disabled={!hasUnsavedChanges || isSaving}
          >
            <Save className="h-4 w-4 mr-1" />
            {isSaving ? "Saving..." : "Save"}
          </Button>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-auto">
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
