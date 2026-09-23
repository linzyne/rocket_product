export interface OrderRow {
  발주번호: string;
  물류센터: string;
  상품이름: string;
  확정수량: number | '';
  입고예정일: Date | string;
  메모: string;
  쉼먼트: string;
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
