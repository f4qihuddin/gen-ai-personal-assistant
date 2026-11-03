import Chat from "./Chat.jsx";
import SpeakerLibrary from "./SpeakerLibrary.jsx";
import Document from "./ResearchAgent.jsx";

function MainView({ activePage }) {
  switch (activePage) {
    case "chat":
      return (
        <main className="main-view">
          <Chat />
        </main>
      );
    case "speaker library":
      return (
        <main className="main-view">
          <SpeakerLibrary />
        </main>
      );
    case "research":
      return (
        <main className="main-view">
          <Document/>
        </main>
      );
    default:
      return (
        <main className="main-view">
          <h1>Page not found</h1>
        </main>
      );
  }
}

export default MainView;
