export function PageHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="planner-page-header space-y-2 border-b border-border bg-card px-4 py-6 sm:px-6 sm:py-7">
      <h1 className="text-2xl font-semibold leading-tight tracking-tight sm:text-[28px]">{title}</h1>
      <p className="max-w-[75ch] text-sm leading-6 text-muted-foreground">{description}</p>
    </header>
  );
}
