import { DomainError } from '../../../src/domain/shared/errors/domain.error';
import { TransientError } from '../../../src/domain/shared/errors/transient.error';

describe('TransientError', () => {
  it('fica fora da família de domínio: quem o vê retenta, não recusa', () => {
    expect(new TransientError('deadlock')).toBeInstanceOf(Error);
    expect(new TransientError('deadlock')).not.toBeInstanceOf(DomainError);
    expect(new TransientError('deadlock').name).toBe('TransientError');
  });

  it('preserva a causa original para a investigação', () => {
    const causa = new Error('ER_LOCK_DEADLOCK');
    expect(new TransientError('deadlock ao reservar', causa).cause).toBe(causa);
  });

  it('aceita não ter causa nenhuma', () => {
    expect(new TransientError('timeout').cause).toBeUndefined();
  });
});
