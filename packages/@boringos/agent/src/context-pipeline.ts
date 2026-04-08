import type { ContextProvider, ContextBuildEvent } from "./types.js";

export class ContextPipeline {
  private providers: ContextProvider[] = [];

  add(provider: ContextProvider): void {
    this.providers.push(provider);
    this.providers.sort((a, b) => {
      const phaseOrder = a.phase === "system" ? 0 : 1;
      const phaseOrderB = b.phase === "system" ? 0 : 1;
      if (phaseOrder !== phaseOrderB) return phaseOrder - phaseOrderB;
      return a.priority - b.priority;
    });
  }

  remove(name: string): void {
    this.providers = this.providers.filter((p) => p.name !== name);
  }

  async build(event: ContextBuildEvent): Promise<{ systemInstructions: string; contextMarkdown: string }> {
    const systemParts: string[] = [];
    const contextParts: string[] = [];

    for (const provider of this.providers) {
      const result = await provider.provide(event);
      if (result) {
        if (provider.phase === "system") {
          systemParts.push(result);
        } else {
          contextParts.push(result);
        }
      }
    }

    return {
      systemInstructions: systemParts.join("\n\n"),
      contextMarkdown: contextParts.join("\n\n"),
    };
  }

  list(): ContextProvider[] {
    return [...this.providers];
  }
}
