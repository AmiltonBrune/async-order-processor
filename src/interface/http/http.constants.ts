export const IS_PUBLIC = 'isPublic';
export const REQUIRED_ROLES = 'requiredRoles';

export const ID_DO_PEDIDO = {
  name: 'id',
  format: 'uuid',
  example: '0193a000-0000-7000-8000-000000000001',
  description: 'UUIDv7 devolvido pelo POST /orders.',
} as const;
