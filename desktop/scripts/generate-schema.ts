/**
 * Regenerate platforms.schema.json from the zod Registry schema.
 *
 * Run in the container-only verify environment:
 *   docker-verify.sh generates it via the `test` drift guard's source of truth;
 *   this script prints the exact JSON so the committed file can be refreshed:
 *     node scripts/generate-schema.ts > platforms.schema.json
 *
 * The committed file is the language-neutral contract the Android
 * RegistryValidator enforces; the vitest drift guard fails if it goes stale.
 */
import { z } from 'zod'
import { Registry } from '../src/shared/types.ts'

process.stdout.write(JSON.stringify(z.toJSONSchema(Registry), null, 2) + '\n')
