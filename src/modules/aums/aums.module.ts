import { Module } from '@nitrostack/core';
import { AumsTools } from './aums.tools.js';

@Module({
  name: 'aums',
  description: 'AUMS Student Portal Data Access Module',
  controllers: [AumsTools],
})
export class AumsModule {}