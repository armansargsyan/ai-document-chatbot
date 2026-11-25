import { AppService } from './app.service';

describe('AppService', () => {
  it('reports ok with an ISO timestamp', () => {
    const health = new AppService().getHealth();
    expect(health.status).toBe('ok');
    expect(new Date(health.timestamp).toISOString()).toBe(health.timestamp);
  });
});
