import { buildPlexusDevFlagOverrides } from "@/wab/server/pkg-mgr";
import { PLEXUS_INSERTABLE_ID } from "@/wab/shared/insertables";

describe("buildPlexusDevFlagOverrides", () => {
  const projectId = "sku8iwsELqAmVdbX3sqZff";
  const overrides = buildPlexusDevFlagOverrides({
    projectId,
    sysname: PLEXUS_INSERTABLE_ID,
  });

  it("enables the plexus flag", () => {
    expect(overrides.plexus).toBe(true);
  });

  it("registers the Plasmic Design System installable pointing at the project", () => {
    expect(overrides.installables).toEqual([
      {
        type: "ui-kit",
        isInstallOnly: true,
        isNew: true,
        name: "Plasmic Design System",
        projectId,
        imageUrl: "https://static1.plasmic.app/plasmic-logo.png",
        entryPoint: { type: "arena", name: "Components" },
      },
    ]);
  });

  it("points every insertable template at the project id and namespaces templateName by sysname", () => {
    const group = overrides.insertableTemplates;
    expect(group?.type).toBe("insertable-templates-group");
    const components = group?.items?.[0];
    expect(components?.type).toBe("insertable-templates-group");
    const items = (components as any).items as any[];
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.type).toBe("insertable-templates-component");
      expect(item.projectId).toBe(projectId);
      expect(item.tokenResolution).toBe("reuse-by-name");
      expect(item.templateName.startsWith(`${PLEXUS_INSERTABLE_ID}/`)).toBe(
        true
      );
    }
  });

  it("wires the insert-panel install-all button to the project id", () => {
    expect(
      overrides.insertPanelContent?.builtinSectionsInstallables?.[
        "Customizable components"
      ]
    ).toBe(projectId);
  });
});
