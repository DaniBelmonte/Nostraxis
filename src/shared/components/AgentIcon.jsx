import { GithubLogo, OpenAiLogo } from '@phosphor-icons/react';

export const PROVIDER_NAMES = { codex: 'Codex / ChatGPT', claude: 'Claude', copilot: 'GitHub Copilot', hermes: 'Hermes Agent' };

function ClaudeLogo() {
  return <svg className="claude-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8v18.4M4.1 7.4l15.8 9.2M4.1 16.6l15.8-9.2M2.8 12h18.4" />
  </svg>;
}

// Hermes' own favicon uses the caduceus. This reduced line version keeps the
// mark recognisable at the dashboard's 11-17 px icon sizes.
function HermesLogo() {
  return <svg className="hermes-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3v18M12 6c-2.7-3-5.4-2.7-7.5-1.4 1.1 2.5 3.3 4 7.5 3M12 6c2.7-3 5.4-2.7 7.5-1.4-1.1 2.5-3.3 4-7.5 3" />
    <path d="M8.2 9.6c0 2.2 7.6 2.3 7.6 4.7 0 1.6-1.7 2.4-3.8 2.8M15.8 9.6c0 2.2-7.6 2.3-7.6 4.7 0 1.6 1.7 2.4 3.8 2.8" />
  </svg>;
}

export function AgentIcon({ id }) {
  if (id === 'codex') return <OpenAiLogo weight="fill" />;
  if (id === 'claude') return <ClaudeLogo />;
  if (id === 'hermes') return <HermesLogo />;
  return <GithubLogo weight="fill" />;
}
