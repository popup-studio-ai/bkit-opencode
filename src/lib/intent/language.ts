/**
 * Multilingual Trigger Patterns
 *
 * Defines keyword patterns for agent and skill triggers across 8 languages:
 * English, Korean, Japanese, Chinese, Spanish, French, German, Italian.
 */

// ---------------------------------------------------------------------------
// Supported languages
// ---------------------------------------------------------------------------

export const SUPPORTED_LANGUAGES = ["en", "ko", "ja", "zh", "es", "fr", "de", "it"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// ---------------------------------------------------------------------------
// Agent trigger patterns
// ---------------------------------------------------------------------------

/**
 * Maps agent names to an array of trigger keywords across supported languages.
 *
 * Language order within each array:
 *   EN, KO, JA, ZH, ES, FR, DE, IT
 */
export const AGENT_TRIGGER_PATTERNS: Record<string, string[]> = {
  "gap-detector": [
    // EN
    "verify",
    "check",
    "validate",
    "gap",
    "compare",
    "correct",
    "right",
    "match",
    // KO
    "\uAC80\uC99D",        // 검증
    "\uD655\uC778",        // 확인
    "\uBE44\uAD50",        // 비교
    "\uB9DE\uC544",        // 맞아
    "\uAD1C\uCC2E\uC544",  // 괜찮아
    "\uBB38\uC81C",        // 문제
    "\uC124\uACC4\uB300\uB85C", // 설계대로
    // JA
    "\u78BA\u8A8D",        // 確認
    "\u691C\u8A3C",        // 検証
    "\u6B63\u3057\u3044",  // 正しい
    "\u5408\u3063\u3066\u308B", // 合ってる
    "\u5927\u4E08\u592B",  // 大丈夫
    // ZH
    "\u9A8C\u8BC1",        // 验证
    "\u68C0\u67E5",        // 检查
    "\u5BF9\u6BD4",        // 对比
    "\u5BF9\u5417",        // 对吗
    "\u6B63\u786E",        // 正确
    // ES
    "verificar",
    "comprobar",
    "validar",
    // FR
    "v\u00E9rifier",       // vérifier
    "valider",
    "comparer",
    // DE
    "pr\u00FCfen",         // prüfen
    "verifizieren",
    "validieren",
    // IT
    "verificare",
    "controllare",
    "validare",
  ],

  "pdca-iterator": [
    // EN
    "improve",
    "iterate",
    "fix",
    "refine",
    "enhance",
    "optimize",
    // KO
    "\uAC1C\uC120",        // 개선
    "\uBC18\uBCF5",        // 반복
    "\uC218\uC815",        // 수정
    "\uCD5C\uC801\uD654",  // 최적화
    "\uACE0\uCE58",        // 고치
    // JA
    "\u6539\u5584",        // 改善
    "\u53CD\u5FA9",        // 反復
    "\u4FEE\u6B63",        // 修正
    "\u6700\u9069\u5316",  // 最適化
    "\u76F4\u3057\u3066",  // 直して
    // ZH
    "\u6539\u8FDB",        // 改进
    "\u8FED\u4EE3",        // 迭代
    "\u4FEE\u590D",        // 修复
    "\u4F18\u5316",        // 优化
    // ES
    "mejorar",
    "iterar",
    "corregir",
    "optimizar",
    // FR
    "am\u00E9liorer",     // améliorer
    "it\u00E9rer",        // itérer
    "corriger",
    "optimiser",
    // DE
    "verbessern",
    "iterieren",
    "korrigieren",
    "optimieren",
    // IT
    "migliorare",
    "iterare",
    "correggere",
    "ottimizzare",
  ],

  "code-analyzer": [
    // EN
    "analyze",
    "analysis",
    "quality",
    "review",
    "inspect",
    "audit",
    // KO
    "\uBD84\uC11D",        // 분석
    "\uD488\uC9C8",        // 품질
    "\uB9AC\uBDF0",        // 리뷰
    "\uAC80\uD1A0",        // 검토
    // JA
    "\u5206\u6790",        // 分析
    "\u54C1\u8CEA",        // 品質
    "\u30EC\u30D3\u30E5\u30FC", // レビュー
    "\u691C\u8A0E",        // 検討
    // ZH
    "\u5206\u6790",        // 分析
    "\u8D28\u91CF",        // 质量
    "\u5BA1\u67E5",        // 审查
    "\u68C0\u8BA8",        // 检讨
    // ES
    "analizar",
    "calidad",
    "revisar",
    // FR
    "analyser",
    "qualit\u00E9",       // qualité
    "r\u00E9viser",       // réviser
    // DE
    "analysieren",
    "Qualit\u00E4t",      // Qualität
    "\u00FCberpr\u00FCfen", // überprüfen
    // IT
    "analizzare",
    "qualit\u00E0",       // qualità
    "revisionare",
    "esaminare",
  ],

  "report-generator": [
    // EN
    "report",
    "summary",
    "complete",
    "conclude",
    "final",
    "wrap up",
    // KO
    "\uBCF4\uACE0\uC11C",  // 보고서
    "\uC694\uC57D",        // 요약
    "\uC644\uB8CC",        // 완료
    "\uB9C8\uBB34\uB9AC",  // 마무리
    "\uACB0\uACFC",        // 결과
    // JA
    "\u5831\u544A",        // 報告
    "\u30EC\u30DD\u30FC\u30C8", // レポート
    "\u8981\u7D04",        // 要約
    "\u5B8C\u4E86",        // 完了
    "\u307E\u3068\u3081",  // まとめ
    // ZH
    "\u62A5\u544A",        // 报告
    "\u6458\u8981",        // 摘要
    "\u5B8C\u6210",        // 完成
    "\u603B\u7ED3",        // 总结
    // ES
    "informe",
    "resumen",
    "completar",
    "concluir",
    // FR
    "rapport",
    "r\u00E9sum\u00E9",   // résumé
    "compl\u00E9ter",      // compléter
    "conclure",
    // DE
    "Bericht",
    "Zusammenfassung",
    "abschlie\u00DFen",    // abschließen
    "fertigstellen",
    // IT
    "rapporto",
    "riepilogo",
    "completare",
    "concludere",
  ],

  "starter-guide": [
    // EN
    "help",
    "beginner",
    "getting started",
    "how to",
    "tutorial",
    "guide",
    "new to",
    // KO
    "\uB3C4\uC6C0",        // 도움
    "\uCD08\uBCF4",        // 초보
    "\uC2DC\uC791",        // 시작
    "\uC5B4\uB5BB\uAC8C",  // 어떻게
    "\uAC00\uC774\uB4DC",  // 가이드
    "\uCC98\uC74C",        // 처음
    // JA
    "\u52A9\u3051\u3066",  // 助けて
    "\u521D\u5FC3\u8005",  // 初心者
    "\u59CB\u3081\u65B9",  // 始め方
    "\u3069\u3046\u3084\u3063\u3066", // どうやって
    "\u30AC\u30A4\u30C9",  // ガイド
    // ZH
    "\u5E2E\u52A9",        // 帮助
    "\u65B0\u624B",        // 新手
    "\u5F00\u59CB",        // 开始
    "\u600E\u4E48",        // 怎么
    "\u6307\u5357",        // 指南
    // ES
    "ayuda",
    "principiante",
    "empezar",
    "c\u00F3mo",          // cómo
    // FR
    "aide",
    "d\u00E9butant",      // débutant
    "commencer",
    "comment",
    // DE
    "Hilfe",
    "Anf\u00E4nger",      // Anfänger
    "anfangen",
    "wie",
    // IT
    "aiuto",
    "principiante",
    "iniziare",
    "come",
  ],

  "backend-expert": [
    // EN
    "backend",
    "server",
    "API",
    "REST",
    "GraphQL",
    "middleware",
    "endpoint",
    "route",
    "Express",
    "Fastify",
    "NestJS",
    "FastAPI",
    "Django",
    "Flask",
    "Gin",
    "Axum",
    "Spring Boot",
    // KO
    "\uBC31\uC5D4\uB4DC \uAD6C\uCD95",  // 백엔드 구축
    "\uC11C\uBC84",        // 서버
    "\uBBF8\uB4E4\uC6E8\uC5B4", // 미들웨어
    "\uB77C\uC6B0\uD2B8",  // 라우트
    "\uC5D4\uB4DC\uD3EC\uC778\uD2B8", // 엔드포인트
    // JA
    "\u30D0\u30C3\u30AF\u30A8\u30F3\u30C9", // バックエンド
    "\u30B5\u30FC\u30D0\u30FC", // サーバー
    "\u30DF\u30C9\u30EB\u30A6\u30A7\u30A2", // ミドルウェア
    "\u30EB\u30FC\u30C6\u30A3\u30F3\u30B0", // ルーティング
    // ZH
    "\u540E\u7AEF",        // 后端
    "\u670D\u52A1\u5668",  // 服务器
    "\u4E2D\u95F4\u4EF6",  // 中间件
    "\u8DEF\u7531",        // 路由
    // ES
    "servidor",
    "ruta",
    // FR
    "serveur",
    "route",
    // DE
    "Server",
    "Route",
    // IT
    "server",
    "percorso",
  ],

  "baas-expert": [
    // EN
    "login",
    "auth",
    "authentication",
    "database",
    "backend",
    "signup",
    "session",
    "token",
    "oauth",
    // KO
    "\uB85C\uADF8\uC778",  // 로그인
    "\uC778\uC99D",        // 인증
    "\uB370\uC774\uD130\uBCA0\uC774\uC2A4", // 데이터베이스
    "\uD68C\uC6D0\uAC00\uC785", // 회원가입
    "\uBC31\uC5D4\uB4DC",  // 백엔드
    // JA
    "\u30ED\u30B0\u30A4\u30F3", // ログイン
    "\u8A8D\u8A3C",        // 認証
    "\u30C7\u30FC\u30BF\u30D9\u30FC\u30B9", // データベース
    "\u30B5\u30A4\u30F3\u30A2\u30C3\u30D7", // サインアップ
    // ZH
    "\u767B\u5F55",        // 登录
    "\u8BA4\u8BC1",        // 认证
    "\u6570\u636E\u5E93",  // 数据库
    "\u6CE8\u518C",        // 注册
    // ES
    "autenticaci\u00F3n",  // autenticación
    "base de datos",
    "iniciar sesi\u00F3n", // iniciar sesión
    // FR
    "authentification",
    "base de donn\u00E9es", // base de données
    "connexion",
    // DE
    "Authentifizierung",
    "Datenbank",
    "Anmeldung",
    // IT
    "autenticazione",
    "database",
    "accesso",
    "accedere",
  ],

  "cto-lead": [
    // EN
    "team",
    "project lead",
    "CTO",
    "orchestrate",
    "coordinate",
    "lead",
    // KO
    "\uD300",              // 팀
    "\uD504\uB85C\uC81D\uD2B8 \uB9AC\uB4DC", // 프로젝트 리드
    "\uC870\uC728",        // 조율
    "\uD611\uC5C5",        // 협업
    "\uCD1D\uAD04",        // 총괄
    // JA
    "\u30C1\u30FC\u30E0",  // チーム
    "\u30D7\u30ED\u30B8\u30A7\u30AF\u30C8\u30EA\u30FC\u30C9", // プロジェクトリード
    "\u8ABF\u6574",        // 調整
    "\u7D71\u62EC",        // 統括
    // ZH
    "\u56E2\u961F",        // 团队
    "\u9879\u76EE\u8D1F\u8D23\u4EBA", // 项目负责人
    "\u534F\u8C03",        // 协调
    "\u7EDF\u7B79",        // 统筹
    // ES
    "equipo",
    "l\u00EDder",          // líder
    "coordinar",
    // FR
    "\u00E9quipe",         // équipe
    "chef de projet",
    "coordonner",
    // DE
    "Team",
    "Projektleiter",
    "koordinieren",
    // IT
    "squadra",
    "capo progetto",
    "coordinare",
  ],

  "frontend-architect": [
    // EN
    "UI",
    "UX",
    "component",
    "design system",
    "layout",
    "responsive",
    "CSS",
    "styling",
    "React",
    "Next.js",
    // KO
    "\uCEF4\uD3EC\uB10C\uD2B8", // 컴포넌트
    "\uB514\uC790\uC778 \uC2DC\uC2A4\uD15C", // 디자인 시스템
    "\uB808\uC774\uC544\uC6C3", // 레이아웃
    "\uD504\uB860\uD2B8\uC5D4\uB4DC", // 프론트엔드
    "\uC2A4\uD0C0\uC77C\uB9C1", // 스타일링
    // JA
    "\u30B3\u30F3\u30DD\u30FC\u30CD\u30F3\u30C8", // コンポーネント
    "\u30C7\u30B6\u30A4\u30F3\u30B7\u30B9\u30C6\u30E0", // デザインシステム
    "\u30EC\u30A4\u30A2\u30A6\u30C8", // レイアウト
    "\u30D5\u30ED\u30F3\u30C8\u30A8\u30F3\u30C9", // フロントエンド
    // ZH
    "\u7EC4\u4EF6",        // 组件
    "\u8BBE\u8BA1\u7CFB\u7EDF", // 设计系统
    "\u5E03\u5C40",        // 布局
    "\u524D\u7AEF",        // 前端
    // ES
    "componente",
    "sistema de dise\u00F1o", // sistema de diseño
    // FR
    "composant",
    "syst\u00E8me de design", // système de design
    // DE
    "Komponente",
    "Design-System",
    // IT
    "componente",
    "sistema di design",
  ],

  "security-architect": [
    // EN
    "security",
    "vulnerability",
    "OWASP",
    "XSS",
    "CSRF",
    "injection",
    "penetration",
    "threat",
    // KO
    "\uBCF4\uC548",        // 보안
    "\uCDE8\uC57D\uC810",  // 취약점
    "\uC778\uAC00",        // 인가
    // JA
    "\u30BB\u30AD\u30E5\u30EA\u30C6\u30A3", // セキュリティ
    "\u8106\u5F31\u6027",  // 脆弱性
    // ZH
    "\u5B89\u5168",        // 安全
    "\u6F0F\u6D1E",        // 漏洞
    // ES
    "seguridad",
    "vulnerabilidad",
    // FR
    "s\u00E9curit\u00E9",  // sécurité
    "vuln\u00E9rabilit\u00E9", // vulnérabilité
    // DE
    "Sicherheit",
    "Schwachstelle",
    // IT
    "sicurezza",
    "vulnerabilit\u00E0",  // vulnerabilità
  ],

  "enterprise-expert": [
    // EN
    "microservice",
    "enterprise",
    "scalable",
    "monorepo",
    "high traffic",
    "distributed",
    // KO
    "\uB9C8\uC774\uD06C\uB85C\uC11C\uBE44\uC2A4", // 마이크로서비스
    "\uC5D4\uD130\uD504\uB77C\uC774\uC988", // 엔터프라이즈
    "\uB300\uADDC\uBAA8",  // 대규모
    "\uD655\uC7A5\uC131",  // 확장성
    // JA
    "\u30DE\u30A4\u30AF\u30ED\u30B5\u30FC\u30D3\u30B9", // マイクロサービス
    "\u30A8\u30F3\u30BF\u30FC\u30D7\u30E9\u30A4\u30BA", // エンタープライズ
    "\u5927\u898F\u6A21",  // 大規模
    // ZH
    "\u5FAE\u670D\u52A1",  // 微服务
    "\u4F01\u4E1A\u7EA7",  // 企业级
    "\u5206\u5E03\u5F0F",  // 分布式
    // ES
    "microservicio",
    "empresa",
    "escalable",
    // FR
    "microservice",
    "entreprise",
    "\u00E9volutif",       // évolutif
    // DE
    "Microservice",
    "Unternehmen",
    "skalierbar",
    // IT
    "microservizio",
    "aziendale",
    "scalabile",
  ],

  "infra-architect": [
    // EN
    "kubernetes",
    "k8s",
    "terraform",
    "AWS",
    "docker",
    "CI/CD",
    "infrastructure",
    "deploy",
    "EKS",
    "RDS",
    // KO
    "\uCFE0\uBC84\uB124\uD2F0\uC2A4", // 쿠버네티스
    "\uC778\uD504\uB77C",  // 인프라
    "\uBC30\uD3EC",        // 배포
    "\uD074\uB77C\uC6B0\uB4DC", // 클라우드
    // JA
    "\u30A4\u30F3\u30D5\u30E9", // インフラ
    "\u30C7\u30D7\u30ED\u30A4", // デプロイ
    "\u30AF\u30E9\u30A6\u30C9", // クラウド
    // ZH
    "\u57FA\u7840\u8BBE\u65BD", // 基础设施
    "\u90E8\u7F72",        // 部署
    "\u4E91",              // 云
    // ES
    "infraestructura",
    "despliegue",
    "nube",
    // FR
    "infrastructure",
    "d\u00E9ploiement",    // déploiement
    "cloud",
    // DE
    "Infrastruktur",
    "Bereitstellung",
    "Cloud",
    // IT
    "infrastruttura",
    "distribuzione",
    "cloud",
  ],

  "product-manager": [
    // EN
    "requirements",
    "user story",
    "feature spec",
    "scope",
    "prioritize",
    "PRD",
    "roadmap",
    // KO
    "\uC694\uAD6C\uC0AC\uD56D", // 요구사항
    "\uC6B0\uC120\uC21C\uC704", // 우선순위
    "\uBC94\uC704",        // 범위
    "\uC2A4\uD1A0\uB9AC",  // 스토리
    "\uAE30\uD68D",        // 기획
    // JA
    "\u8981\u4EF6",        // 要件
    "\u512A\u5148\u5EA6",  // 優先度
    "\u30B9\u30B3\u30FC\u30D7", // スコープ
    "\u4ED5\u69D8",        // 仕様
    // ZH
    "\u9700\u6C42",        // 需求
    "\u4F18\u5148\u7EA7",  // 优先级
    "\u8303\u56F4",        // 范围
    "\u89C4\u683C",        // 规格
    // ES
    "requisitos",
    "prioridad",
    "alcance",
    // FR
    "exigences",
    "priorit\u00E9",       // priorité
    "port\u00E9e",         // portée
    // DE
    "Anforderungen",
    "Priorit\u00E4t",      // Priorität
    "Umfang",
    // IT
    "requisiti",
    "priorit\u00E0",       // priorità
    "ambito",
  ],

  "qa-strategist": [
    // EN
    "test strategy",
    "QA plan",
    "test plan",
    "quality metrics",
    "testing",
    "test coverage",
    // KO
    "\uD14C\uC2A4\uD2B8 \uC804\uB7B5", // 테스트 전략
    "QA \uACC4\uD68D",    // QA 계획
    "\uD14C\uC2A4\uD2B8 \uACC4\uD68D", // 테스트 계획
    "\uD488\uC9C8 \uAE30\uC900", // 품질 기준
    // JA
    "\u30C6\u30B9\u30C8\u6226\u7565", // テスト戦略
    "QA\u8A08\u753B",     // QA計画
    "\u54C1\u8CEA\u57FA\u6E96", // 品質基準
    // ZH
    "\u6D4B\u8BD5\u7B56\u7565", // 测试策略
    "QA\u8BA1\u5212",     // QA计划
    "\u8D28\u91CF\u6807\u51C6", // 质量标准
    // ES
    "estrategia de pruebas",
    "plan de pruebas",
    // FR
    "strat\u00E9gie de test", // stratégie de test
    "plan de test",
    // DE
    "Teststrategie",
    "Testplan",
    // IT
    "strategia di test",
    "piano di test",
  ],

  "qa-monitor": [
    // EN
    "docker logs",
    "log analysis",
    "zero script",
    "monitor",
    "log-based",
    // KO
    "\uB85C\uADF8 \uBD84\uC11D", // 로그 분석
    "\uBAA8\uB2C8\uD130\uB9C1", // 모니터링
    "\uB3C4\uCEE4 \uB85C\uADF8", // 도커 로그
    // JA
    "\u30ED\u30B0\u5206\u6790", // ログ分析
    "\u30E2\u30CB\u30BF\u30EA\u30F3\u30B0", // モニタリング
    // ZH
    "\u65E5\u5FD7\u5206\u6790", // 日志分析
    "\u76D1\u63A7",        // 监控
    // ES
    "an\u00E1lisis de logs", // análisis de logs
    "monitoreo",
    // FR
    "analyse de logs",
    "surveillance",
    // DE
    "Log-Analyse",
    "\u00DCberwachung",    // Überwachung
    // IT
    "analisi dei log",
    "monitoraggio",
  ],

  "design-validator": [
    // EN
    "design review",
    "spec check",
    "validate design",
    "design completeness",
    "specification review",
    // KO
    "\uC124\uACC4 \uAC80\uC99D", // 설계 검증
    "\uC124\uACC4 \uAC80\uD1A0", // 설계 검토
    "\uC2A4\uD399 \uD655\uC778", // 스펙 확인
    "\uC124\uACC4\uC11C \uAC80\uD1A0", // 설계서 검토
    // JA
    "\u8A2D\u8A08\u691C\u8A3C", // 設計検証
    "\u4ED5\u69D8\u30C1\u30A7\u30C3\u30AF", // 仕様チェック
    // ZH
    "\u8BBE\u8BA1\u9A8C\u8BC1", // 设计验证
    "\u89C4\u683C\u68C0\u67E5", // 规格检查
    // ES
    "revisi\u00F3n de dise\u00F1o", // revisión de diseño
    "validaci\u00F3n de dise\u00F1o", // validación de diseño
    // FR
    "revue de conception",
    "validation de conception",
    // DE
    "Design-Review",
    "Spezifikationspr\u00FCfung", // Spezifikationsprüfung
    // IT
    "revisione del design",
    "validazione del design",
  ],

  "pipeline-guide": [
    // EN
    "pipeline",
    "development order",
    "which phase",
    "where to start",
    "what phase",
    "next phase",
    // KO
    "\uD30C\uC774\uD504\uB77C\uC778", // 파이프라인
    "\uAC1C\uBC1C \uC21C\uC11C", // 개발 순서
    "\uBB50\uBD80\uD130",  // 뭐부터
    "\uC5B4\uB514\uC11C\uBD80\uD130", // 어디서부터
    // JA
    "\u30D1\u30A4\u30D7\u30E9\u30A4\u30F3", // パイプライン
    "\u4F55\u304B\u3089",  // 何から
    "\u3069\u3053\u304B\u3089", // どこから
    // ZH
    "\u5F00\u53D1\u6D41\u7A0B", // 开发流程
    "\u4ECE\u54EA\u91CC\u5F00\u59CB", // 从哪里开始
    // ES
    "pipeline",
    "por d\u00F3nde empezar", // por dónde empezar
    // FR
    "pipeline",
    "par o\u00F9 commencer", // par où commencer
    // DE
    "Pipeline",
    "wo anfangen",
    // IT
    "pipeline",
    "da dove iniziare",
  ],
};

// ---------------------------------------------------------------------------
// Skill trigger patterns
// ---------------------------------------------------------------------------

/**
 * Maps skill identifiers to keywords that imply the user wants that skill.
 */
export const SKILL_TRIGGER_PATTERNS: Record<string, string[]> = {
  starter: [
    "starter",
    "simple",
    "basic",
    "beginner",
    "landing page",
    "\uAE30\uBCF8",       // 기본
    "\uAC04\uB2E8",       // 간단
    "\u57FA\u672C",       // 基本
    "b\u00E1sico",        // básico
    "basique",
    "einfach",
    "semplice",
  ],
  dynamic: [
    "dynamic",
    "fullstack",
    "full-stack",
    "backend",
    "API",
    "server",
    "\uD480\uC2A4\uD0DD",  // 풀스택
    "\uBC31\uC5D4\uB4DC",  // 백엔드
    "\u30D5\u30EB\u30B9\u30BF\u30C3\u30AF", // フルスタック
    "\u5168\u6808",       // 全栈
  ],
  enterprise: [
    "enterprise",
    "microservice",
    "kubernetes",
    "k8s",
    "infrastructure",
    "terraform",
    "\uC5D4\uD130\uD504\uB77C\uC774\uC988", // 엔터프라이즈
    "\u30A8\u30F3\u30BF\u30FC\u30D7\u30E9\u30A4\u30BA", // エンタープライズ
    "\u4F01\u4E1A\u7EA7",  // 企业级
  ],
  mobile: [
    "mobile",
    "app",
    "iOS",
    "android",
    "react native",
    "expo",
    "flutter",
    "\uBAA8\uBC14\uC77C",  // 모바일
    "\u30E2\u30D0\u30A4\u30EB", // モバイル
    "\u79FB\u52A8",       // 移动
    "m\u00F3vil",         // móvil
  ],
  desktop: [
    "desktop",
    "electron",
    "tauri",
    "native",
    "\uB370\uC2A4\uD06C\uD1B1", // 데스크톱
    "\u30C7\u30B9\u30AF\u30C8\u30C3\u30D7", // デスクトップ
    "\u684C\u9762",       // 桌面
    "escritorio",
    "bureau",
  ],
};

// ---------------------------------------------------------------------------
// New feature intent keywords
// ---------------------------------------------------------------------------

/**
 * Keywords across languages that indicate the user wants to create or
 * implement a new feature.
 */
export const NEW_FEATURE_KEYWORDS: string[] = [
  // EN
  "add",
  "create",
  "implement",
  "build",
  "develop",
  "make",
  "new feature",
  "introduce",
  // KO
  "\uB9CC\uB4E4\uC5B4",   // 만들어
  "\uCD94\uAC00",          // 추가
  "\uAD6C\uD604",          // 구현
  "\uAC1C\uBC1C",          // 개발
  "\uC0DD\uC131",          // 생성
  "\uC0C8\uB85C\uC6B4",   // 새로운
  // JA
  "\u4F5C\u3063\u3066",   // 作って
  "\u8FFD\u52A0",         // 追加
  "\u5B9F\u88C5",         // 実装
  "\u958B\u767A",         // 開発
  "\u4F5C\u6210",         // 作成
  "\u65B0\u3057\u3044",   // 新しい
  // ZH
  "\u5F00\u53D1",         // 开发
  "\u521B\u5EFA",         // 创建
  "\u5B9E\u73B0",         // 实现
  "\u6DFB\u52A0",         // 添加
  "\u65B0\u529F\u80FD",   // 新功能
  // ES
  "crear",
  "implementar",
  "desarrollar",
  "a\u00F1adir",          // añadir
  "nueva funcionalidad",
  // FR
  "cr\u00E9er",           // créer
  "impl\u00E9menter",     // implémenter
  "d\u00E9velopper",      // développer
  "ajouter",
  "nouvelle fonctionnalit\u00E9", // nouvelle fonctionnalité
  // DE
  "erstellen",
  "implementieren",
  "entwickeln",
  "hinzuf\u00FCgen",      // hinzufügen
  "neue Funktion",
  // IT
  "creare",
  "implementare",
  "sviluppare",
  "aggiungere",
  "nuova funzionalit\u00E0", // nuova funzionalità
];

// ---------------------------------------------------------------------------
// Language detection & pattern matching
// ---------------------------------------------------------------------------

/**
 * Detect the primary language of a text string by checking Unicode ranges.
 * Returns "en" as the default.
 */
export function detectLanguage(text: string): SupportedLanguage {
  if (!text) return "en";
  // Korean (Hangul)
  if (/[\uAC00-\uD7AF]/.test(text)) return "ko";
  // Japanese (Hiragana / Katakana)
  if (/[\u3040-\u30FF]/.test(text)) return "ja";
  // Chinese (CJK Unified Ideographs, excluding Korean/Japanese)
  if (/[\u4E00-\u9FFF]/.test(text) && !/[\uAC00-\uD7AF\u3040-\u30FF]/.test(text)) return "zh";
  return "en";
}

/**
 * Flatten a nested language-keyed pattern map into a single deduplicated array.
 * Works with both the nested `{lang: [keywords]}` format and the flat `string[]` format.
 */
export function getAllPatterns(patternMap: Record<string, string[]> | string[]): string[] {
  if (Array.isArray(patternMap)) return [...new Set(patternMap)];

  const all: string[] = [];
  for (const lang of SUPPORTED_LANGUAGES) {
    const patterns = patternMap[lang];
    if (patterns) all.push(...patterns);
  }
  return [...new Set(all)];
}

/**
 * Check if `text` matches any keyword in a nested language pattern map.
 * Also works with flat arrays.
 */
export function matchMultiLangPattern(
  text: string,
  patternMap: Record<string, string[]> | string[]
): boolean {
  const lowerText = text.toLowerCase();

  if (Array.isArray(patternMap)) {
    return patternMap.some((p) => lowerText.includes(p.toLowerCase()));
  }

  for (const lang of SUPPORTED_LANGUAGES) {
    const patterns = patternMap[lang];
    if (!patterns) continue;
    for (const pattern of patterns) {
      if (lowerText.includes(pattern.toLowerCase())) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Trigger table generator
// ---------------------------------------------------------------------------

/**
 * Generates a markdown table showing all agent trigger keywords organised by
 * language for documentation or display purposes.
 */
export function generateTriggerTable(): string {
  const languages = ["EN", "KO", "JA", "ZH", "ES", "FR", "DE", "IT"];

  const lines: string[] = [];
  lines.push("# Agent Trigger Keywords");
  lines.push("");
  lines.push(
    `| Agent | ${languages.join(" | ")} |`
  );
  lines.push(
    `|-------|${languages.map(() => "------").join("|")}|`
  );

  for (const [agent, triggers] of Object.entries(AGENT_TRIGGER_PATTERNS)) {
    // Group triggers by language (approximate: first batch EN, then KO, JA, ZH, ES, FR, DE, IT)
    // Since the arrays are flat, we present them as a single comma-separated list per agent
    // but split into rough language buckets based on character ranges.
    const buckets = categorizeTriggers(triggers);
    const cells = languages.map((lang) => {
      const keywords = buckets[lang] ?? [];
      return keywords.slice(0, 3).join(", ") || "-";
    });
    lines.push(`| ${agent} | ${cells.join(" | ")} |`);
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Rough categorisation of trigger keywords by detecting script/character ranges.
 */
function categorizeTriggers(triggers: string[]): Record<string, string[]> {
  const buckets: Record<string, string[]> = {
    EN: [],
    KO: [],
    JA: [],
    ZH: [],
    ES: [],
    FR: [],
    DE: [],
    IT: [],
  };

  for (const t of triggers) {
    if (/[\uAC00-\uD7AF]/.test(t)) {
      buckets.KO.push(t);
    } else if (/[\u3040-\u30FF\u31F0-\u31FF]/.test(t)) {
      // Hiragana/Katakana present => Japanese
      buckets.JA.push(t);
    } else if (/[\u4E00-\u9FFF]/.test(t) && !/[\u3040-\u30FF]/.test(t)) {
      // CJK without kana => Chinese
      buckets.ZH.push(t);
    } else if (/[a-zA-Z]/.test(t)) {
      // Latin script -- distinguish by diacritics or common patterns
      if (/[\u00E0\u00E8\u00F2\u00EC]/.test(t) || /[a-z]{3,}are$|ione$|ilogo$/.test(t)) {
        buckets.IT.push(t);
      } else if (/[\u00E9\u00E8\u00EA\u00EE\u00F4\u00FB\u00E7]/.test(t) || (/er$|oir$/.test(t) && /[éèêîôûç]/.test(t))) {
        buckets.FR.push(t);
      } else if (/[\u00FC\u00F6\u00E4\u00DF]/.test(t) || /ieren$|ung$/.test(t)) {
        buckets.DE.push(t);
      } else if (/[\u00E1\u00ED\u00F3\u00FA\u00F1]/.test(t) || (/ci[oó]n$|[a-z]{3,}ar$/.test(t) && /[áíóúñ]/.test(t))) {
        buckets.ES.push(t);
      } else {
        buckets.EN.push(t);
      }
    } else {
      // Fallback
      buckets.EN.push(t);
    }
  }

  return buckets;
}
