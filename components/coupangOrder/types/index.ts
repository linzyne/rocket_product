export interface OrderRow {
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: Date | string;
  메모: string;
  쉼먼트: string;
  // 여러 발주서를 한 택배(한 상자)로 보낼 때 묶는 이름. 예: "묶음1". 빈 값이면 안 묶인 줄.
  묶음?: string;
  // 묶음 택배를 보낼 물류센터. 묶음 카드에서 직접 고른 값이며, 비어 있으면 첫 줄의 물류센터를 쓴다.
  // (발주서 원래 물류센터는 그대로 두고, 택배 주소만 이 값으로 잡는다.)
  묶음센터?: string;
  // 묶음에서 새로 잡은 입고예정일('YYYY-MM-DD'). 센터를 바꾸면 날짜도 같이 바뀌는 경우가 많아 함께 둔다.
  // "묶음 적용"을 누르면 이 값이 발주서의 물류센터·입고예정일로 옮겨간다.
  묶음일자?: string;
}

export interface OrderBundle {
  rows: OrderRow[];
  isReserved: boolean;
}

export interface AddressEntry {
  key: string;      // 물류센터명
  addr1: string;    // 주소1
  addr2: string;    // 주소2 (상세)
  phone: string;
  zip: string;
}

export interface LotteRow {
  주문번호: string | number;
  받는사람: string;
  전화번호1: string;
  우편번호: string;
  주소: string;
  상품명1: string;
}

export interface SenderInfo {
  name: string;    // 보내는사람(지정)
  phone1: string;  // 전화번호1(지정)
  phone2: string;  // 전화번호2(지정)
  zip: string;     // 우편번호(지정)
  addr: string;    // 주소(지정)
}
