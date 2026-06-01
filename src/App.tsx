import { useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ContextPanel } from "./components/ContextPanel";
import { StatusBar } from "./components/StatusBar";
import { Board } from "./components/Board";
import { NotepadView } from "./components/NotepadView";
import { HarvestsView } from "./components/HarvestsView";
import { useLiveState } from "./hooks/useLiveState";
import { useProjects, type SkeinProject } from "./hooks/useProjects";

export type Tab = "briefing" | "sessions" | "threads" | "narrative" | "plans";
export type View = "board" | "workspace" | "notepad" | "harvests";

const VIEW_LABELS: Record<View, string> = {
  board: "Parking Lot",
  workspace: "Workspace",
  notepad: "Notepad",
  harvests: "Harvests",
};

export default function App() {
  const [selectedProject, setSelectedProject] = useState<SkeinProject | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("briefing");
  const [view, setView] = useState<View>("board");
  const liveState = useLiveState();
  const { projects, loading: projectsLoading } = useProjects();

  return (
    <div className="flex h-screen flex-col">
      <nav
        className="flex items-center gap-1 border-b px-3 py-1.5"
        style={{ borderColor: "var(--skein-border)", background: "var(--skein-sidebar)" }}
      >
        {(["board", "workspace", "notepad", "harvests"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors"
            style={{
              background: view === v ? "var(--skein-panel)" : "transparent",
              color: view === v ? "var(--skein-text)" : "var(--skein-text-muted)",
            }}
          >
            {VIEW_LABELS[v]}
          </button>
        ))}
      </nav>

      {view === "board" ? (
        <Board />
      ) : view === "notepad" ? (
        <NotepadView />
      ) : view === "harvests" ? (
        <HarvestsView />
      ) : (
        <>
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          projects={projects}
          loading={projectsLoading}
          selectedProject={selectedProject}
          onSelectProject={(project) => {
            setSelectedProject(project);
            setActiveTab("briefing");
          }}
        />
        <ContextPanel
          project={selectedProject}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          liveState={liveState}
        />
      </div>
      <StatusBar
        projects={projects}
        liveState={liveState}
      />
        </>
      )}
    </div>
  );
}
