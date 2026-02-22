import { TitleDescriptionForm } from './TitleDescriptionForm';
import { KeywordTabs } from './KeywordTabs';

export function MainForm() {
  return (
    <div className="flex flex-col flex-1 min-h-0 rounded-xl bg-transparent">
      <TitleDescriptionForm />
      <div className="flex flex-col flex-1 min-h-0 rounded-xl bg-card border border-border p-3">
        <KeywordTabs />
      </div>
    </div>
  );
}
