import { GithubLogo, OpenAiLogo } from '@phosphor-icons/react';

export const PROVIDER_NAMES = { codex: 'Codex / ChatGPT', claude: 'Claude', copilot: 'GitHub Copilot' };

function ClaudeLogo() {
  return <svg className="claude-logo" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.8v18.4M4.1 7.4l15.8 9.2M4.1 16.6l15.8-9.2M2.8 12h18.4" />
  </svg>;
}

export function AgentIcon({ id }) {
  if (id === 'codex') return <OpenAiLogo weight="fill" />;
  if (id === 'claude') return <ClaudeLogo />;
  return <GithubLogo weight="fill" />;
}
