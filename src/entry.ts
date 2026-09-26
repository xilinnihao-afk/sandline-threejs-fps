import { setupMobileBrowser } from './ui/mobileBrowser';
import { startup } from './ui/startup';
import { setupCommunity } from './ui/community';

setupCommunity();
setupMobileBrowser();
startup.begin();
try {
  await import('./main');
} catch (error) {
  console.error('Game startup failed', error);
  startup.fail('游戏程序或资源加载失败，请检查网络后重试。', 'program_or_asset');
}
