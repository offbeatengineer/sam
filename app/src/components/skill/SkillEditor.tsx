import { useEffect, useState, useCallback } from "react";
import { AlertTriangle, ChevronUp, ChevronDown } from "lucide-react";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { SkillEditorPanel } from "./SkillEditorPanel";
import { SkillFilesPanel } from "./SkillFilesPanel";
import { useSkillStore } from "@/stores/skillStore";
import { cn } from "@/lib/utils";
import type { SkillContent } from "@/types/skill";

interface SkillEditorProps {
  skillId: string;
}

export function SkillEditor({ skillId }: SkillEditorProps) {
  const { skills, loadSkillContent, saveSkillContent, currentSkillContent } = useSkillStore();

  // Body content state
  const [bodyContent, setBodyContent] = useState("");

  // Frontmatter state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("");

  // Track whether local state has been initialized from currentSkillContent
  const [contentInitialized, setContentInitialized] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [metadataPanelOpen, setMetadataPanelOpen] = useState(true);
  // null = editing SKILL.md, otherwise absolute path to the .md file
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  // Saved content for non-SKILL.md files (to compare for unsaved changes)
  const [savedFileContent, setSavedFileContent] = useState("");

  const skill = skills.find((s) => s.id === skillId);
  const isSkillMd = activeFilePath === null;
  const activeFileName = isSkillMd ? "SKILL.md" : activeFilePath.split("/").pop() ?? "";

  // Derive unsaved changes by comparing current content to saved content
  const hasUnsavedChanges = isSkillMd
    ? currentSkillContent != null && (
        bodyContent !== currentSkillContent.body ||
        name !== currentSkillContent.frontmatter.name ||
        description !== currentSkillContent.frontmatter.description ||
        version !== currentSkillContent.frontmatter.metadata.version
      )
    : bodyContent !== savedFileContent;

  // Reset to SKILL.md when switching skills
  useEffect(() => {
    setActiveFilePath(null);
    setContentInitialized(false);
    loadSkillContent(skillId);
  }, [skillId, loadSkillContent]);

  useEffect(() => {
    if (currentSkillContent && isSkillMd) {
      setBodyContent(currentSkillContent.body);
      setName(currentSkillContent.frontmatter.name);
      setDescription(currentSkillContent.frontmatter.description);
      setVersion(currentSkillContent.frontmatter.metadata.version);
      setContentInitialized(true);
    }
  }, [currentSkillContent, isSkillMd]);

  const handleBodyChange = useCallback((content: string) => {
    setBodyContent(content);
  }, []);

  const handleFrontmatterChange = useCallback(
    (field: "name" | "description" | "version", value: string) => {
      if (field === "name") setName(value);
      else if (field === "description") setDescription(value);
      else if (field === "version") setVersion(value);
    },
    []
  );

  const handleFileClick = useCallback(async (filePath: string) => {
    if (filePath.endsWith("/SKILL.md")) {
      setActiveFilePath(null);
      if (currentSkillContent) {
        setBodyContent(currentSkillContent.body);
      }
      return;
    }

    try {
      const content = await readTextFile(filePath);
      setActiveFilePath(filePath);
      setBodyContent(content);
      setSavedFileContent(content);
    } catch (error) {
      console.error("Failed to read file:", error);
    }
  }, [currentSkillContent]);

  const handleSave = async () => {
    if (skill?.isSystem) return;

    setIsSaving(true);
    try {
      if (isSkillMd) {
        if (!currentSkillContent) return;
        const updatedContent: SkillContent = {
          frontmatter: {
            name,
            description,
            metadata: {
              author: currentSkillContent.frontmatter.metadata.author,
              version,
            },
          },
          body: bodyContent,
        };
        await saveSkillContent(skillId, updatedContent);
      } else {
        await writeTextFile(activeFilePath!, bodyContent);
        setSavedFileContent(bodyContent);
      }
    } catch (error) {
      console.error("Failed to save:", error);
    } finally {
      setIsSaving(false);
    }
  };

  if (!skill) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Skill not found
      </div>
    );
  }

  if (!currentSkillContent || (isSkillMd && !contentInitialized)) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex-1 flex">
      {/* Main editor area */}
      <div className="flex-1 flex flex-col min-w-0 bg-sidebar">
        {/* Header */}
        <div className="h-12 px-4 flex items-center border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-sm font-medium truncate">{isSkillMd ? (name || skill.name) : activeFileName}</h2>
            {skill.isSystem && (
              <span className="shrink-0 text-[10px] font-medium bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                READ-ONLY
              </span>
            )}
            {hasUnsavedChanges && !skill.isSystem && (
              <span className="shrink-0 text-[10px] font-medium bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1.5 py-0.5 rounded">
                UNSAVED
              </span>
            )}
          </div>
        </div>

        {/* System skill warning banner */}
        {skill.isSystem && (
          <div className="px-4 py-2 bg-muted/50 border-b border-border flex items-center gap-2 text-sm text-muted-foreground">
            <AlertTriangle className="h-4 w-4" />
            System skills cannot be modified. Create a new skill to customize.
          </div>
        )}

        {/* Editor with toolbar */}
        <div className="flex-1 overflow-hidden">
          <SkillEditorPanel
            content={bodyContent}
            onChange={handleBodyChange}
            readOnly={skill.isSystem}
            onSave={handleSave}
            hasUnsavedChanges={hasUnsavedChanges}
            isSaving={isSaving}
          />
        </div>

        {/* Frontmatter section at bottom - only for SKILL.md */}
        {isSkillMd && <div className="shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.1)]">
          {/* Toggle button */}
          <button
            onClick={() => setMetadataPanelOpen(!metadataPanelOpen)}
            className="w-full px-4 py-2 flex items-center justify-between border-t border-border hover:bg-accent/50 transition-colors"
          >
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Skill Metadata
            </span>
            {metadataPanelOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            )}
          </button>

          {/* Collapsible content */}
          <div
            className={cn(
              "overflow-hidden transition-all duration-200 ease-in-out",
              metadataPanelOpen ? "max-h-[500px] opacity-100" : "max-h-0 opacity-0"
            )}
          >
            <div className="px-4 pb-4 pt-2 space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Name</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => handleFrontmatterChange("name", e.target.value)}
                    disabled={skill.isSystem}
                    className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Version</label>
                  <input
                    type="text"
                    value={version}
                    onChange={(e) => handleFrontmatterChange("version", e.target.value)}
                    disabled={skill.isSystem}
                    className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">Description</label>
                <textarea
                  value={description}
                  onChange={(e) => handleFrontmatterChange("description", e.target.value)}
                  disabled={skill.isSystem}
                  rows={2}
                  className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 resize-none disabled:opacity-50 disabled:cursor-not-allowed"
                />
              </div>
            </div>
          </div>
        </div>}
      </div>

      {/* Files panel */}
      <div className="w-64 shrink-0">
        <SkillFilesPanel
          skillPath={skill.path}
          skillName={skill.name}
          onFileClick={handleFileClick}
          activeFilePath={activeFilePath ?? `${skill.path}/SKILL.md`}
        />
      </div>
    </div>
  );
}
