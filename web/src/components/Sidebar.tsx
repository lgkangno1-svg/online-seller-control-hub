import {
  BarChart3,
  BookOpenCheck,
  Bot,
  Boxes,
  CircleDollarSign,
  ClipboardList,
  CreditCard,
  Link2,
  PackagePlus,
  PackageSearch,
  Settings,
  SlidersHorizontal,
  UserCheck
} from "lucide-react";

const navItems = [
  ["대시보드", BarChart3],
  ["시작 가이드", BookOpenCheck],
  ["상품 관리", PackageSearch],
  ["상품 등록", PackagePlus],
  ["주문 관리", ClipboardList],
  ["재고 관리", Boxes],
  ["가격 관리", CircleDollarSign],
  ["마켓 연동", Link2],
  ["자동화 규칙", SlidersHorizontal],
  ["AI 명령", Bot],
  ["요금제", CreditCard],
  ["설정", Settings]
] as const;

type Props = {
  active: string;
  admin?: boolean;
  onSelect: (value: string) => void;
  onFeedback: () => void;
};

export function Sidebar({ active, admin = false, onSelect, onFeedback }: Props) {
  const select = (label: string) => {
    if (label === "시작 가이드") {
      onSelect("마켓 연동");
      window.setTimeout(() => document.getElementById("getting-started")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      return;
    }
    onSelect(label);
  };

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">S</div>
        <div>
          <strong>SellerHub</strong>
          <span>BETA</span>
        </div>
      </div>

      <nav className="sidebar-nav" aria-label="주요 메뉴">
        {navItems.map(([label, Icon]) => (
          <button
            key={label}
            type="button"
            className={label !== "시작 가이드" && active === label ? "nav-item active" : "nav-item"}
            onClick={() => select(label)}
          >
            <Icon size={19} strokeWidth={1.9} />
            <span>{label}</span>
          </button>
        ))}
        {admin ? (
          <button
            type="button"
            className={active === "가입 승인" ? "nav-item active" : "nav-item"}
            onClick={() => onSelect("가입 승인")}
          >
            <UserCheck size={19} strokeWidth={1.9} />
            <span>가입 승인</span>
          </button>
        ) : null}
      </nav>

      <div className="beta-card">
        <strong>{admin ? "관리자" : "베타 테스터"}</strong>
        <p>{admin ? "가입 신청과 서비스 운영 상태를 관리합니다." : "처음이라면 시작 가이드에서 API 키 발급부터 차례대로 진행하세요."}</p>
        <div className="beta-progress" aria-hidden="true"><span /></div>
        <small>핵심 기능 8 / 10</small>
        <button type="button" onClick={onFeedback}>피드백 보내기</button>
      </div>
    </aside>
  );
}
