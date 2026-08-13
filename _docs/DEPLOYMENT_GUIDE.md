# 공개 배포 원칙

이 문서는 공개 저장소에서 공유할 수 있는 애플리케이션 배포 경계만 정의합니다. 환경별 인프라 구성, 호스트 경로, runner, proxy, registry, 실제 도메인과 secret 위치는 별도 비공개 문서에서 관리합니다.

## 배포 전 검증

```bash
npm ci
npm test
npm run build
npm audit --audit-level=high
```

- `.env.example`에는 빈 값 또는 명시적 placeholder만 둡니다.
- private key, service account JSON, 실제 DB·Redis·OAuth credential은 Git에 저장하지 않습니다.
- API와 worker에 필요한 환경변수는 `src/config/environment.ts`에서 시작 전에 검증합니다.

## DB 변경

- `migrations/`의 범용 SQL은 개발자가 대상 DB와 백업을 확인한 뒤 수동으로 실행합니다.
- API 시작 과정에서 migration이나 `sequelize.sync()`를 실행하지 않습니다.
- add-only migration을 우선하고 애플리케이션 롤백 동안 신규 nullable 컬럼·테이블을 유지합니다.
- rollback SQL은 데이터 존재 여부와 별도 승인 조건을 확인한 경우에만 사용합니다.

## 애플리케이션 롤백

1. 신규 기능 flag를 비활성화합니다.
2. 직전 검증 이미지로 애플리케이션을 복구합니다.
3. liveness와 PostgreSQL readiness를 확인합니다.
4. add-only DB 객체는 즉시 삭제하지 않습니다.

## 공개/비공개 경계

공개 저장소에 포함할 수 있는 항목:

- 애플리케이션 소스와 테스트
- 범용 migration과 rollback guard
- OpenAPI와 환경변수 이름
- 공급자 독립적인 운영 원칙

비공개로 관리할 항목:

- 환경별 workflow, Compose와 proxy 설정
- 실제 호스트·포트·경로·runner·registry 식별자
- DB·Redis·OAuth·Firebase 실제 값
- private key, service account와 암호화 키
- 환경별 실행 기록과 백업 식별자
