import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService, PublicUser } from './auth.service';

export type AuthedRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: PublicUser;
  sessionToken?: string;
};

function readBearerToken(req: AuthedRequest): string {
  const header = req.headers['authorization'];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value || !value.startsWith('Bearer ')) return '';
  return value.slice('Bearer '.length).trim();
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const token = readBearerToken(request);
    if (!token) throw new UnauthorizedException('Требуется вход в аккаунт');

    const user = this.auth.getSession(token);
    if (!user) throw new UnauthorizedException('Сессия истекла, войдите заново');

    request.user = user;
    request.sessionToken = token;
    this.auth.touch(user.id);
    return true;
  }
}

@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (request.user?.role !== 'admin') {
      throw new ForbiddenException('Доступ только для администратора');
    }
    return true;
  }
}
