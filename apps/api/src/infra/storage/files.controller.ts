import { createReadStream } from 'node:fs';
import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { FILE_STORE } from './object-storage.tokens';
import type { FilesystemObjectStorage } from './filesystem-object-storage';

const notFound = () =>
  new NotFoundException({ code: 'FILE_NOT_FOUND', message: 'Fichier introuvable.' });

/**
 * `GET /files/:key` (FEAT-022, SPEC-022-04 R3, R4): a public file (logo, cover)
 * by its stable address; a private file (papers) only with a valid, unexpired
 * signed link — otherwise 403, which never tells whether the file exists. No
 * session here: the link itself is the authorization, handed out by the routes
 * that check who may see the file.
 */
@ApiTags('files')
@Controller('files')
export class FilesController {
  constructor(@Inject(FILE_STORE) private readonly files: FilesystemObjectStorage | null) {}

  @Get(':key')
  async read(
    @Param('key') key: string,
    @Query('exp') exp: string | undefined,
    @Query('sig') sig: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    if (!this.files) throw notFound();
    const found = await this.files.resolveRead(key, exp, sig);
    if (found.kind === 'forbidden') {
      throw new ForbiddenException({
        code: 'FILE_LINK_INVALID',
        message: 'Lien expiré ou invalide.',
      });
    }
    if (found.kind === 'not_found') throw notFound();
    reply.header(
      'Cache-Control',
      found.family === 'public' ? 'public, max-age=31536000, immutable' : 'private, no-store',
    );
    reply.header('X-Content-Type-Options', 'nosniff');
    // Helmet answers `same-origin`, which keeps the consoles (admin., livreur.)
    // from showing an image of api.: a private photo opens for the sites of
    // DJAFAT's own domain, a public logo for any page (FEAT-022 part 2).
    reply.header(
      'Cross-Origin-Resource-Policy',
      found.family === 'public' ? 'cross-origin' : 'same-site',
    );
    return new StreamableFile(createReadStream(found.path), {
      type: found.contentType,
      disposition: 'inline',
    });
  }
}
