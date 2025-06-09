import type { Plugin } from "./plugin-manager";

export function plugin(pluginInstance: Plugin): ClassDecorator {
  return (target: any): any => {
    return class extends target {
      static plugin: Plugin = pluginInstance;

      constructor(...args: any[]) {
        super(...args);

        // Store plugins to register when forge is ready
        if (!(this.constructor as any).__pluginsToRegister) {
          (this.constructor as any).__pluginsToRegister = [];
          (this.constructor as any).__registeredPluginNames = new Set();
        }

        // Only add if not already added
        if (
          !(this.constructor as any).__registeredPluginNames.has(
            pluginInstance.name
          )
        ) {
          (this.constructor as any).__pluginsToRegister.push(pluginInstance);
          (this.constructor as any).__registeredPluginNames.add(
            pluginInstance.name
          );
        }

        // If forge is already available, register immediately
        if ((this.constructor as any).forge) {
          if (
            !(this.constructor as any).forge
              .getPluginManager()
              .hasPlugin(pluginInstance.name)
          ) {
            (this.constructor as any).forge.registerPlugin(pluginInstance);
          }
        }
        // If forgeReady promise exists, register when ready
        else if ((this.constructor as any).forgeReady) {
          (this.constructor as any).forgeReady.then(() => {
            if (
              (this.constructor as any).forge &&
              !(this.constructor as any).forge
                .getPluginManager()
                .hasPlugin(pluginInstance.name)
            ) {
              (this.constructor as any).forge.registerPlugin(pluginInstance);
            }
          });
        }
      }
    };
  };
}
