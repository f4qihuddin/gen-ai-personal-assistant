import { useState } from "react";
import MainView from "./MainView.jsx";
import SideBar from "./SideBar.jsx";

function App() {
  const [activePage, setActivePage] = useState("chat");

  return (
    <div className="main-container">
      <SideBar activePage={activePage} onNavigate={setActivePage} />
      <MainView activePage={activePage} />
    </div>
  );
}

export default App;