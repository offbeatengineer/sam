import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { StartupScreen } from "@/components/StartupScreen";

function App() {
  const [initialized, setInitialized] = useState(false);

  if (!initialized) {
    return <StartupScreen onComplete={() => setInitialized(true)} />;
  }

  return <AppLayout />;
}

export default App;
