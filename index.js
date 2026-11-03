// 影视画面分析器 Host 插件入口：解析工具链、注册 agent 工具与面板 HTTP 接口。
import { resolveToolchain } from './lib/toolchain.js';
import { createService } from './lib/service.js';
import { createToolDefinitions } from './lib/tools.js';
import { registerRoutes } from './lib/routes.js';
import { disposeOcr } from './lib/ocr.js';

export const inject = ['tools', 'webServer'];

export function apply(ctx, config) {
  const resolvedConfig = config && typeof config === 'object' ? config : {};
  const toolchain = resolveToolchain(resolvedConfig);
  const service = createService(toolchain);

  // agent 工具：与面板 API 共用 service 的实现。
  ctx.effect(() => {
    const disposers = [];
    for (const definition of createToolDefinitions(service)) {
      disposers.push(ctx.tools.register(definition));
    }
    return () => {
      while (disposers.length > 0) {
        const dispose = disposers.pop();
        try {
          dispose();
        } catch {
          // 忽略重复释放
        }
      }
    };
  }, 'film-analysis: tools');

  // 面板 HTTP 接口（invoke / upload / file / output）。
  ctx.effect(() => registerRoutes(ctx, service), 'film-analysis: panel routes');

  // OCR worker 随插件卸载终止。
  ctx.effect(() => () => {
    void disposeOcr();
  }, 'film-analysis: ocr worker');
}
