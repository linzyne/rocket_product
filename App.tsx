
import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Product, ArchivedProduct } from './types';
import ProductRow from './components/ProductRow';
import ProductGroupSummary from './components/ProductGroupSummary';
import ProductListPage from './components/ProductListPage';
import { PlusIcon, DownloadIcon, CloseIcon, BroomIcon, SearchIcon, DocumentAddIcon, SaveIcon, CameraIcon, SettingsIcon, TagIcon, CheckIcon, ArchiveIcon } from './components/Icons';
import ProductLabel from './components/ProductLabel';
import BarcodeLabel from './components/BarcodeLabel';
import MarginCalculatorModal from './components/MarginCalculatorModal';
import QuoteGeneratorModal from './components/QuoteGeneratorModal';
import QuoteSettingsModal from './components/QuoteSettingsModal';
import QuoteTemplateManagerModal from './components/QuoteTemplateManagerModal';
import MemoModal from './components/MemoModal';
import NotepadSidebar from './components/NotepadSidebar';
import ImageRenamer from './components/ImageRenamer';
import TranslationModal from './components/TranslationModal';
import ImageEditorModal from './components/ImageEditorModal';
import DetailPageBuilderModal from './components/DetailPageBuilderModal';
import MissingFieldsModal from './components/MissingFieldsModal';
import { saveDataUrlInProductFolder, productFolderName, productNameFolderName, buildZipBlob, saveFilesInProductFolder, getRootDirectory } from './utils/fileSave';
import { collectMissingFields } from './utils/productValidation';
import {
  QuoteFixedValues,
  DEFAULT_QUOTE_FIXED_VALUES,
  QuoteTemplateRegistration,
  getQuoteTemplates,
  fillQuoteWorkbook,
  parseQuoteWorkbookToProduct,
  dataUrlToArrayBuffer,
  findMissingRequiredCells,
  ensureRequiredCustomFields,
  getAutoCustomFieldValue,
  extractExposureAttributeLabels,
  findNewExposureAttributeLabels,
  normalizeHeader,
  getProductMaterialValue,
  RequiredFieldGap,
  OPTION_FIELD_COLOR,
} from './data/quoteTemplates';
import { getAllQuoteTemplates, putQuoteTemplate, deleteQuoteTemplate } from './data/quoteTemplateStore';
import { generateProductImportFields } from './utils/geminiProductImport';
import { generateId } from './utils/id';
import { generateBarcodeNumber } from './utils/barcode';
import { withCoLtdSuffix } from './utils/manufacturerFormat';
import { db, isFirebaseConfigured, ensureSignedIn } from './utils/firebase';
import { collection, doc, setDoc, deleteDoc, getDocs, onSnapshot } from 'firebase/firestore';

// This tells TypeScript that the global variables from CDNs exist.
declare var XLSX: any;
declare var html2canvas: any;
declare var ExcelJS: any;

// 옵션(색상 등) 순번에 맞춰 "001s.png"(대표) / "001.png"(상세) / "001L.png"(라벨) 형태의 기본
// 파일명을 만든다. 옵션 그룹 안에서 이 순번이 항상 1,2,3...으로 이어지도록 호출하는 쪽에서
// 맞춰준다(handleImportFrom1688, handleDuplicateProduct 등 옵션을 새로 만드는 지점 참고).
const numberedFileNames = (orderNumber?: number): Pick<Product, 'thumbnailFile' | 'detailFile' | 'labelFile'> => {
  const numStr = orderNumber && orderNumber > 0 ? String(orderNumber).padStart(3, '0') : '';
  return {
    thumbnailFile: numStr ? `${numStr}s.png` : '',
    detailFile: numStr ? `${numStr}.png` : '',
    labelFile: numStr ? `${numStr}L.png` : '',
  };
};

const createNewProduct = (orderNumber?: number): Product => {
  return {
    id: generateId(),
    url: '',
    memo: '',
    category: '',
    quoteTemplateId: '',
    productName: '',
    sku: '',
    barcode: generateBarcodeNumber(),
    costPrice: '',
    supplyPrice: '',
    sellingPrice: '',
    margin: '',
    color: '',
    quantity: '1',
    searchKeyword: '',
    sizeWidth: '',
    sizeHeight: '',
    sizeDepth: '',
    packageSize: '',
    packageSizeSameAsProduct: true,
    weight: '',
    manufacturer: '주노엘협력사',
    material: '',
    countryOfOrigin: 'Made in China',
    importer: '주노엘',
    recommendedAge: '만14세이상',
    asContact: '주노엘 01048629452',
    cautionNote: '화기주의',
    ...numberedFileNames(orderNumber),
    thumbnailDataUrl: '',
    detailDataUrl: '',
    labelDataUrl: '',
    customFields: {},
  };
};

// 옵션(색상 등)이 다른 여러 상품행을 같은 상품 그룹으로 묶기 위한 키. URL이 있으면 그 URL을
// 공유하는 행들을 한 그룹으로 보고, URL이 없는(아직 채워지지 않은) 행은 각자 자기 자신만의
// 그룹으로 취급한다.
const getProductGroupKey = (product: Pick<Product, 'id' | 'url'>): string => {
  const url = product.url.trim();
  return url ? `url:${url}` : `id:${product.id}`;
};

// 상세페이지와 라벨(제품필수표시사항) 이미지는 모두 옵션 그룹 전체가 공유하는 한 장이므로,
// 견적서에는 옵션마다 다른 자기 자신의 detailFile/labelFile이 아니라 그룹 첫 번째 옵션의
// 파일명을 모든 행에 동일하게 채운다.
const withSharedGroupFiles = (groupProducts: Product[]): Product[] => {
  const sharedDetailFile = groupProducts[0]?.detailFile ?? '';
  const sharedLabelFile = groupProducts[0]?.labelFile ?? '';
  return groupProducts.map(p => (
    p.detailFile === sharedDetailFile && p.labelFile === sharedLabelFile
      ? p
      : { ...p, detailFile: sharedDetailFile, labelFile: sharedLabelFile }
  ));
};

const getInitialProducts = (): Product[] => {
  try {
    const savedProductsJSON = localStorage.getItem('products');
    if (savedProductsJSON) {
      let savedProducts = JSON.parse(savedProductsJSON);
      
      if (Array.isArray(savedProducts)) {
        savedProducts = savedProducts.filter(p => p && typeof p === 'object');
      } else {
        savedProducts = [];
      }

      if (savedProducts.length > 0) {
        const seenIds = new Set<string>();
        
        return savedProducts.map((p: Partial<Product>) => {
          const hydratedProduct = { ...createNewProduct(), ...p };

          if (!hydratedProduct.id || seenIds.has(hydratedProduct.id)) {
            hydratedProduct.id = generateId();
          }
          seenIds.add(hydratedProduct.id);

          // macOS 환경 등에서 예전에 자모 분리(NFD) 상태로 저장된 한글이 남아있으면(화면엔 정상으로
          // 보이지만 엑셀 등에서는 깨져 보임) 불러오는 시점에 조합형(NFC)으로 정리한다.
          (Object.keys(hydratedProduct) as (keyof Product)[]).forEach(key => {
            const v = hydratedProduct[key];
            if (typeof v === 'string') (hydratedProduct as any)[key] = v.normalize('NFC');
          });

          return hydratedProduct;
        });
      }
    }
  } catch (error) {
    console.error("Failed to load products from localStorage", error);
  }
  
  return [createNewProduct(1)];
};

const getInitialQuoteFixedValues = (): QuoteFixedValues => {
  try {
    const savedJSON = localStorage.getItem('quoteFixedValues');
    if (savedJSON) {
      return { ...DEFAULT_QUOTE_FIXED_VALUES, ...JSON.parse(savedJSON) };
    }
  } catch (error) {
    console.error("Failed to load quote fixed values from localStorage", error);
  }

  return DEFAULT_QUOTE_FIXED_VALUES;
};

// 견적서 파일은 IndexedDB에 저장하지만, 구버전(localStorage 기반)에서 등록했던
// 데이터가 남아있을 수 있으므로 앱 시작 시 1회 마이그레이션에 사용합니다.
const getLegacyQuoteTemplateRegistrations = (): QuoteTemplateRegistration[] => {
  try {
    const savedJSON = localStorage.getItem('quoteTemplateRegistrations');
    if (savedJSON) {
      const parsed = JSON.parse(savedJSON);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error("Failed to load legacy quote template registrations from localStorage", error);
  }

  return [];
};

// 카테고리는 견적서 등록과 별개로 독립적으로 저장됩니다.
// 사용자가 명시적으로 삭제하기 전까지는(견적서를 삭제하더라도) 절대 사라지지 않습니다.
const getInitialCategories = (): string[] => {
  try {
    const savedJSON = localStorage.getItem('categories');
    if (savedJSON) {
      const parsed = JSON.parse(savedJSON);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (error) {
    console.error("Failed to load categories from localStorage", error);
  }

  return [];
};

// 상품목록(등록 이력)은 이미지/엑셀 파일 없이 url·상품명·가격·바코드만 담는 가벼운 스냅샷이라
// products와 별개의 localStorage 키에 저장해서, 상품 목록을 삭제/초기화해도 남아있게 한다.
// 사용자가 직접 삭제 버튼을 누르기 전엔 절대 사라지면 안 되는 데이터라, 쓸 때마다 별도의 백업
// 키에도 함께 저장해두고 원본 키가 어떤 이유로든 깨져 있으면 백업에서 복구한다.
const ARCHIVE_STORAGE_KEY = 'productArchive';
const ARCHIVE_BACKUP_STORAGE_KEY = 'productArchive_backup';
// Firebase가 설정돼 있으면(utils/firebase.ts) 이 Firestore 컬렉션이 진짜 저장소가 되고, 여러
// 컴퓨터가 이 컬렉션 하나를 실시간으로 공유해서 본다. localStorage는 그 위에 얹는 로컬 캐시일 뿐이다.
const ARCHIVE_COLLECTION = 'rocketProposalArchive';

const parseArchiveJSON = (json: string | null): ArchivedProduct[] | null => {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const getInitialArchivedProducts = (): ArchivedProduct[] => {
  const primary = parseArchiveJSON(localStorage.getItem(ARCHIVE_STORAGE_KEY));
  if (primary) return primary;

  const backup = parseArchiveJSON(localStorage.getItem(ARCHIVE_BACKUP_STORAGE_KEY));
  if (backup) {
    console.warn('상품목록(productArchive)이 손상되어 백업에서 복구했습니다.');
    return backup;
  }

  return [];
};

const isBlankProductForArchive = (p: Product): boolean => !p.url.trim() && !p.productName.trim();

const buildArchiveEntry = (p: Product): ArchivedProduct => ({
  id: generateId(),
  savedAt: new Date().toISOString(),
  url: p.url.trim(),
  productName: p.productName.trim(),
  costPrice: p.costPrice,
  supplyPrice: p.supplyPrice,
  sellingPrice: p.sellingPrice,
  barcode: p.barcode,
  color: p.color,
  sizeWidth: p.sizeWidth,
  sizeHeight: p.sizeHeight,
  sizeDepth: p.sizeDepth,
  material: getProductMaterialValue(p),
  countryOfOrigin: p.countryOfOrigin,
  recommendedAge: p.recommendedAge,
  cautionNote: p.cautionNote,
  importer: p.importer,
  manufacturer: p.manufacturer,
});


const App: React.FC = () => {
  const [products, setProducts] = useState<Product[]>(getInitialProducts());
  // 게시판 형태의 상품 그룹 중 펼쳐진(옵션까지 보이는) 그룹을 상품 id로 추적한다. 그룹을 구분하는
  // key(URL 기반)로 직접 추적하면 URL을 타이핑하는 도중 매 글자마다 key가 바뀌어서 펼친 상태가
  // 풀려버리므로, 바뀌지 않는 상품 id를 기준으로 "이 그룹에 속한 상품 중 하나라도 펼쳐짐으로
  // 표시돼 있으면 그 그룹은 펼쳐진 것"으로 판단한다. 기본은 전부 접힌 상태이되, 완전히 빈 새
  // 프로젝트(상품 1개, 아무 값도 없음)일 때만 바로 입력할 수 있게 펼쳐서 시작한다.
  const [expandedProductIds, setExpandedProductIds] = useState<Set<string>>(() => {
    if (products.length === 1 && !products[0].url.trim() && !products[0].productName.trim()) {
      return new Set([products[0].id]);
    }
    return new Set();
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [isLabelModalOpen, setIsLabelModalOpen] = useState(false);
  const [isBarcodeLabelModalOpen, setIsBarcodeLabelModalOpen] = useState(false);
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false);
  const [isQuoteSettingsModalOpen, setIsQuoteSettingsModalOpen] = useState(false);
  const [isQuoteTemplateManagerOpen, setIsQuoteTemplateManagerOpen] = useState(false);
  const [quoteFixedValues, setQuoteFixedValues] = useState<QuoteFixedValues>(getInitialQuoteFixedValues());
  const [quoteTemplateRegistrations, setQuoteTemplateRegistrations] = useState<QuoteTemplateRegistration[]>([]);
  const [categories, setCategories] = useState<string[]>(getInitialCategories());
  const [generatingProductQuoteId, setGeneratingProductQuoteId] = useState<string | null>(null);
  const [integratedDownloadingId, setIntegratedDownloadingId] = useState<string | null>(null);
  const [integratedDownloadDoneId, setIntegratedDownloadDoneId] = useState<string | null>(null);
  // 상세페이지 빌더에서 "상세 이미지로 저장"을 누른 직후 잠깐 체크 아이콘으로 바꿔서, 목록을 훑어볼 때
  // 이 상품은 상세페이지 작업이 끝났다는 걸 알 수 있게 한다(통합다운로드 완료 표시와 같은 패턴).
  const [detailPageDoneId, setDetailPageDoneId] = useState<string | null>(null);
  const [extensionsLinkCopied, setExtensionsLinkCopied] = useState(false);
  const [missingFieldsProductId, setMissingFieldsProductId] = useState<string | null>(null);
  const [requiredFieldGaps, setRequiredFieldGaps] = useState<RequiredFieldGap[] | null>(null);
  const [importingProductQuoteId, setImportingProductQuoteId] = useState<string | null>(null);
  const [importing1688ProductIds, setImporting1688ProductIds] = useState<Set<string>>(new Set());
  // 1688 붙여넣기 시 AI(Gemini)로 상품명/제조사/색상을 번역할지 여부. 끄면 원문 그대로 채워서
  // API 비용이 들지 않는다. 상품행마다 따로 두지 않고 앱 전체에서 공유하는 설정이라 localStorage에 저장한다.
  const [use1688AiTranslation, setUse1688AiTranslation] = useState<boolean>(() => localStorage.getItem('use1688AiTranslation') !== '0');
  const [currentProductForLabel, setCurrentProductForLabel] = useState<Product | null>(null);
  const [generatedLabelImage, setGeneratedLabelImage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentProductForBarcodeLabel, setCurrentProductForBarcodeLabel] = useState<Product | null>(null);
  const [generatedBarcodeLabelImage, setGeneratedBarcodeLabelImage] = useState<string | null>(null);
  const [isGeneratingBarcodeLabel, setIsGeneratingBarcodeLabel] = useState(false);
  // Off-screen 라벨 렌더링/캡처용 (통합다운): 모달을 열지 않고도 같은 ProductLabel 마크업으로 이미지를 만든다.
  const [labelCaptureProduct, setLabelCaptureProduct] = useState<Product | null>(null);
  const labelCaptureResolveRef = useRef<((dataUrl: string | null) => void) | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isSampleExporting, setIsSampleExporting] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [currentView, setCurrentView] = useState<'products' | 'renamer' | 'productList'>('products');
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const resetAllTimeoutRef = useRef<number | null>(null);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [archivedProducts, setArchivedProducts] = useState<ArchivedProduct[]>(getInitialArchivedProducts());

  const [marginCalculatorState, setMarginCalculatorState] = useState<{isOpen: boolean; productId: string | null}>({
    isOpen: false,
    productId: null,
  });
  const [memoModalState, setMemoModalState] = useState<{
    isOpen: boolean;
    product: Product | null;
  }>({ isOpen: false, product: null });
  
  // Translation Modal State
  const [translationState, setTranslationState] = useState<{
    isOpen: boolean;
    imageDataUrl: string | undefined;
    productId: string | null;
    field: 'thumbnailDataUrl' | 'detailDataUrl' | null;
  }>({ isOpen: false, imageDataUrl: undefined, productId: null, field: null });

  // Image Editor Modal State
  const [imageEditorState, setImageEditorState] = useState<{
    isOpen: boolean;
    product: Product | null;
  }>({ isOpen: false, product: null });

  // Detail Page Builder Modal State
  const [detailPageBuilderState, setDetailPageBuilderState] = useState<{
    isOpen: boolean;
    product: Product | null;
  }>({ isOpen: false, product: null });

  const labelRef = useRef<HTMLDivElement>(null);
  const barcodeLabelRef = useRef<HTMLDivElement>(null);
  const hiddenLabelCaptureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return () => {
      if (resetAllTimeoutRef.current) {
        clearTimeout(resetAllTimeoutRef.current);
      }
    };
  }, []);

  // 앱 시작 시 IndexedDB에서 등록된 견적서를 불러옵니다. 구버전에서 localStorage에
  // 저장했던 견적서가 남아있다면 IndexedDB로 옮겨서 계속 사용할 수 있게 합니다.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let loaded = await getAllQuoteTemplates();

        const legacyRegistrations = getLegacyQuoteTemplateRegistrations();
        if (legacyRegistrations.length > 0) {
          const existingIds = new Set(loaded.map(r => r.id));
          const toMigrate = legacyRegistrations.filter(r => r && r.id && !existingIds.has(r.id));
          for (const registration of toMigrate) {
            await putQuoteTemplate(registration);
          }
          if (toMigrate.length > 0) {
            loaded = await getAllQuoteTemplates();
          }
          localStorage.removeItem('quoteTemplateRegistrations');
        }

        if (cancelled) return;
        setQuoteTemplateRegistrations(loaded);

        // 카테고리 레지스트리가 비어있다면(구버전 사용자) 불러온 견적서들의 카테고리를 승계합니다.
        if (!localStorage.getItem('categories')) {
          const migratedCategories = Array.from(new Set(loaded.map(r => r.category).filter(Boolean)));
          if (migratedCategories.length > 0) {
            setCategories(migratedCategories);
            try {
              localStorage.setItem('categories', JSON.stringify(migratedCategories));
            } catch (error) {
              console.error("Failed to save migrated categories to localStorage", error);
            }
          }
        }
      } catch (error) {
        console.error("Failed to load quote templates from IndexedDB", error);
        alert('등록된 견적서를 불러오는 데 실패했습니다. 브라우저가 IndexedDB를 지원하는지 확인해주세요.');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSaveProducts = useCallback(() => {
    setSaveStatus('saving');
    try {
      localStorage.setItem('products', JSON.stringify(products));
      setTimeout(() => { // Give feedback to the user
          setSaveStatus('saved');
          setTimeout(() => setSaveStatus('idle'), 1500);
      }, 500);
    } catch (error) {
      console.error("Failed to save products to localStorage", error);
      alert('저장에 실패했습니다.');
      setSaveStatus('idle');
    }
  }, [products]);

  // 상품목록은 용량이 작아(이미지 없음) 바뀔 때마다 바로 저장해도 부담이 없다. 다만 최초
  // 마운트 시 이 effect가 한 번 더 도는 것까지 그대로 저장해버리면, 어떤 이유로든(다른 곳에서
  // 손상시킨 값 등) 불러오기가 실패해 빈 배열로 시작한 경우 그 순간 원본 데이터를 덮어써서
  // 영구히 잃어버릴 수 있다. 그래서 마운트 직후 첫 실행은 건너뛰고, 실제로 상품을 저장/삭제해서
  // 값이 바뀔 때만 기록한다.
  const isFirstArchivePersistRef = useRef(true);
  useEffect(() => {
    if (isFirstArchivePersistRef.current) {
      isFirstArchivePersistRef.current = false;
      return;
    }
    try {
      const json = JSON.stringify(archivedProducts);
      localStorage.setItem(ARCHIVE_STORAGE_KEY, json);
      localStorage.setItem(ARCHIVE_BACKUP_STORAGE_KEY, json);
    } catch (error) {
      console.error("Failed to save product archive to localStorage", error);
    }
  }, [archivedProducts]);

  // Firebase가 설정돼 있으면 이 컬렉션을 실시간 구독해서, 다른 컴퓨터에서 저장/삭제한 내용이
  // 이 화면에도 바로 반영되게 한다(두 컴퓨터 동시 작업 동기화).
  useEffect(() => {
    if (!isFirebaseConfigured || !db) return;
    const firestore = db;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    (async () => {
      await ensureSignedIn();
      if (cancelled) return;
      unsubscribe = onSnapshot(
        collection(firestore, ARCHIVE_COLLECTION),
        snapshot => {
          const entries = snapshot.docs.map(d => d.data() as ArchivedProduct);
          setArchivedProducts(entries);
        },
        error => {
          console.error('상품목록 실시간 동기화 실패(이 기기에 저장된 내용은 유지됩니다):', error);
        }
      );
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const archiveProducts = useCallback((toArchive: Product[]): boolean => {
    const entries = toArchive.filter(p => !isBlankProductForArchive(p)).map(buildArchiveEntry);
    if (entries.length === 0) return false;

    if (isFirebaseConfigured && db) {
      const firestore = db;
      (async () => {
        try {
          await ensureSignedIn();
          await Promise.all(entries.map(entry => setDoc(doc(firestore, ARCHIVE_COLLECTION, entry.id), entry)));
        } catch (error) {
          console.error('상품목록 클라우드 저장 실패, 이 기기에만 저장합니다:', error);
          setArchivedProducts(prev => [...entries, ...prev]);
        }
      })();
    } else {
      setArchivedProducts(prev => [...entries, ...prev]);
    }
    return true;
  }, []);

  const handleArchiveProduct = useCallback((product: Product): boolean => {
    if (isBlankProductForArchive(product)) {
      alert('URL 또는 상품명이 있어야 상품목록에 저장할 수 있습니다.');
      return false;
    }
    return archiveProducts([product]);
  }, [archiveProducts]);

  // 저장(별표)은 클릭한 옵션 하나가 아니라 같은 URL 그룹의 옵션 전체를 한번에 상품목록에 저장한다.
  const handleArchiveProductGroup = useCallback((groupProducts: Product[]): boolean => {
    const saved = archiveProducts(groupProducts);
    if (!saved) alert('URL 또는 상품명이 있어야 상품목록에 저장할 수 있습니다.');
    return saved;
  }, [archiveProducts]);

  const handleDeleteArchivedProduct = useCallback((id: string) => {
    if (isFirebaseConfigured && db) {
      const firestore = db;
      (async () => {
        try {
          await ensureSignedIn();
          await deleteDoc(doc(firestore, ARCHIVE_COLLECTION, id));
        } catch (error) {
          console.error('상품목록 삭제 실패(클라우드):', error);
        }
      })();
    } else {
      setArchivedProducts(prev => prev.filter(e => e.id !== id));
    }
  }, []);

  const handleClearArchivedProducts = useCallback(() => {
    if (isFirebaseConfigured && db) {
      const firestore = db;
      (async () => {
        try {
          await ensureSignedIn();
          const snapshot = await getDocs(collection(firestore, ARCHIVE_COLLECTION));
          await Promise.all(snapshot.docs.map(d => deleteDoc(d.ref)));
        } catch (error) {
          console.error('상품목록 전체 삭제 실패(클라우드):', error);
        }
      })();
    } else {
      setArchivedProducts([]);
    }
  }, []);

  // 웹페이지는 브라우저 보안 정책상 chrome:// 주소로 직접 이동시킬 수 없어서(클릭해도
  // 조용히 무시됨), 대신 주소를 클립보드에 복사해 사용자가 새 탭에 붙여넣도록 안내한다.
  const handleOpenExtensionsPage = useCallback(async () => {
    const url = 'chrome://extensions/';
    try {
      await navigator.clipboard.writeText(url);
      setExtensionsLinkCopied(true);
      setTimeout(() => setExtensionsLinkCopied(false), 2000);
    } catch (error) {
      console.error('클립보드 복사 실패:', error);
      alert(`브라우저 보안 정책상 웹페이지에서 ${url} 로 바로 이동할 수 없습니다.\n새 탭을 열고 주소창에 아래 주소를 붙여넣어 주세요.\n\n${url}`);
    }
  }, []);

  const expandProductGroup = useCallback((productId: string) => {
    setExpandedProductIds(prev => (prev.has(productId) ? prev : new Set(prev).add(productId)));
  }, []);

  // 그룹 전체를 펼치거나 접는다. 펼쳐진 상태인지는 그룹에 속한 상품 중 하나라도 id가 추적
  // 세트에 있는지로 판단하므로, 접을 때도 그룹에 속한 상품 id를 전부 세트에서 지워야 한다.
  const toggleGroupExpanded = useCallback((groupProductIds: string[]) => {
    setExpandedProductIds(prev => {
      const isExpanded = groupProductIds.some(id => prev.has(id));
      const next = new Set(prev);
      groupProductIds.forEach(id => (isExpanded ? next.delete(id) : next.add(id)));
      return next;
    });
  }, []);

  const handleAddProduct = useCallback(() => {
    // 새로 추가하는 행은 URL이 비어 있어 항상 자기 자신만의 새 옵션 그룹이므로(getProductGroupKey
    // 참고) 전체 행 개수와 상관없이 그 그룹의 첫 번째 옵션(001)으로 시작한다. 다른 상품이 이미
    // 몇 개든 이 상품의 옵션 번호는 001부터 다시 시작해야 나중에 옵션을 복사로 늘려도 어긋나지
    // 않는다(handleDuplicateProduct의 그룹별 번호 매기기와 짝을 맞춤).
    const newProduct = createNewProduct(1);
    setProducts(prev => [...prev, newProduct]);
    expandProductGroup(newProduct.id);
  }, [expandProductGroup]);

  const handleBulkThumbnailUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const newProductsPromises = Array.from(files).map((file: File) => {
      return new Promise<Product>((resolve) => {
        const newProduct = createNewProduct();
        const lastDotIndex = file.name.lastIndexOf('.');
        const fileNameWithoutExtension = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
        
        newProduct.color = fileNameWithoutExtension;
        newProduct.thumbnailFile = file.name;

        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result) {
            newProduct.thumbnailDataUrl = reader.result as string;
          }
          resolve(newProduct);
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(newProductsPromises).then(newlyCreatedProducts => {
      setProducts(prev => {
        const isInitialEmptyProduct = prev.length === 1 &&
          !prev[0].productName &&
          !prev[0].url &&
          !prev[0].thumbnailDataUrl &&
          !prev[0].color;

        if (isInitialEmptyProduct) {
          return newlyCreatedProducts;
        } else {
          return [...prev, ...newlyCreatedProducts];
        }
      });
      newlyCreatedProducts.forEach(p => expandProductGroup(p.id));
    });

    e.target.value = ''; // Reset file input
  }, [expandProductGroup]);

  const handleBulkDetailImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) {
      return;
    }

    const filePromises = Array.from(files).map((file: File) => {
      return new Promise<{ file: File; dataUrl: string }>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          resolve({ file, dataUrl: reader.result as string });
        };
        reader.readAsDataURL(file);
      });
    });

    Promise.all(filePromises).then(loadedFiles => {
      const fileMap = new Map<string, { file: File; dataUrl: string }>();
      loadedFiles.forEach(({ file, dataUrl }) => {
        const lastDotIndex = file.name.lastIndexOf('.');
        const fileNameWithoutExtension = lastDotIndex > 0 ? file.name.substring(0, lastDotIndex) : file.name;
        fileMap.set(fileNameWithoutExtension, { file, dataUrl });
      });

      setProducts(prevProducts => {
        return prevProducts.map(product => {
          const match = fileMap.get(product.color);
          if (match) {
            return {
              ...product,
              detailFile: match.file.name,
              detailDataUrl: match.dataUrl,
            };
          }
          return product;
        });
      });
    });

    e.target.value = ''; // Reset file input
  }, []);


  const handleRemoveProduct = useCallback((productId: string) => {
    const target = products.find(p => p.id === productId);
    if (target) archiveProducts([target]);
    setProducts(prev => {
        if (prev.length <= 1) return prev;
        return prev.filter(p => p.id !== productId);
    });
  }, [products, archiveProducts]);

  const handleRemoveAllProducts = useCallback(() => {
    if (confirmResetAll) {
      archiveProducts(products);
      const resetProduct = createNewProduct(1);
      setProducts([resetProduct]);
      setExpandedProductIds(new Set([resetProduct.id]));
      setConfirmResetAll(false);
      if (resetAllTimeoutRef.current) {
        clearTimeout(resetAllTimeoutRef.current);
        resetAllTimeoutRef.current = null;
      }
    } else {
      setConfirmResetAll(true);
      resetAllTimeoutRef.current = window.setTimeout(() => {
        setConfirmResetAll(false);
        resetAllTimeoutRef.current = null;
      }, 3000);
    }
  }, [confirmResetAll, products, archiveProducts]);

  const handleDuplicateProduct = useCallback((productId: string) => {
    setProducts(prev => {
        const productIndex = prev.findIndex(p => p.id === productId);
        if (productIndex === -1) return prev;

        const productToCopy = prev[productIndex];
        // 복사로 만든 새 옵션은 원본과 같은 파일명을 그대로 물려받으면 옵션 그룹 안에서 번호가
        // 겹친다(예: 둘 다 001s.png) — 지금 그룹에 이미 있는 옵션 수 다음 번호로 새로 매긴다.
        const groupKey = getProductGroupKey(productToCopy);
        const groupSize = prev.filter(p => getProductGroupKey(p) === groupKey).length;
        const newProduct = { ...productToCopy, id: generateId(), barcode: generateBarcodeNumber(), ...numberedFileNames(groupSize + 1) };

        const newProducts = [...prev];
        newProducts.splice(productIndex + 1, 0, newProduct);
        return newProducts;
    });
    const source = products.find(p => p.id === productId);
    if (source) expandProductGroup(source.id);
  }, [products, expandProductGroup]);

  const handleProductChange = useCallback((productId: string, field: keyof Product, rawValue: string) => {
    // macOS는 한글을 자모 분리(NFD)로 다루는 경우가 많아(붙여넣기, 파일명 등) 입력값이 그대로
    // 저장되면 화면에는 정상으로 보여도 엑셀 등 조합을 자동으로 안 해주는 곳에서 깨져 보인다.
    // 저장 시점에 NFC로 정규화해두면(ASCII 값은 no-op) 이후 어디서 쓰이든 항상 정상 조합된다.
    const value = rawValue.normalize('NFC');
    setProducts(prev => {
      const source = prev.find(p => p.id === productId);
      if (!source) return prev;
      // URL/카테고리/견적서는 상품 하나가 아니라 같은 URL을 공유하는 옵션 그룹 전체에 동일하게
      // 적용한다(상세페이지와 같은 방식, getGroupProducts 참고). 그 외 필드는 이 상품 하나만 바뀐다.
      const groupKey = field === 'category' || field === 'quoteTemplateId' || field === 'url' ? getProductGroupKey(source) : null;

      return prev.map(p => {
        if (p.id !== productId && (groupKey === null || getProductGroupKey(p) !== groupKey)) return p;

        if (field === 'quoteTemplateId') {
          // 견적서를 선택하면 그 견적서에 등록된 "추가 항목 이름"들이 상품의 customFields에
          // 빈 값으로 자동 추가됩니다(값은 상품마다 직접 입력). 견적서를 다른 것으로 바꾸면
          // 이전 견적서 전용 항목은 제거되고 새 견적서의 항목으로 교체됩니다.
          const oldReg = quoteTemplateRegistrations.find(r => r.id === p.quoteTemplateId);
          const newReg = quoteTemplateRegistrations.find(r => r.id === value);
          const oldNames = oldReg?.customFieldNames || [];
          const newNames = newReg?.customFieldNames || [];

          const nextCustomFields = { ...p.customFields };
          oldNames.forEach(name => {
            if (!newNames.includes(name)) delete nextCustomFields[name];
          });
          newNames.forEach(name => {
            if (!(name in nextCustomFields)) nextCustomFields[name] = getAutoCustomFieldValue(name);
          });

          return { ...p, quoteTemplateId: value, customFields: nextCustomFields };
        }

        return { ...p, [field]: value };
      });
    });
  }, [quoteTemplateRegistrations]);

  const handleTogglePackageSizeSameAsProduct = useCallback((productId: string, sameAsProduct: boolean) => {
    setProducts(prev =>
      prev.map(p => (p.id === productId ? { ...p, packageSizeSameAsProduct: sameAsProduct } : p))
    );
  }, []);

  const handleSetProductCustomField = useCallback((productId: string, name: string, value: string) => {
    setProducts(prev =>
      prev.map(p =>
        p.id === productId ? { ...p, customFields: { ...p.customFields, [name]: value } } : p
      )
    );
  }, []);

  const handleRemoveProductCustomField = useCallback((productId: string, name: string) => {
    setProducts(prev =>
      prev.map(p => {
        if (p.id !== productId || !(name in p.customFields)) return p;
        const { [name]: _removed, ...rest } = p.customFields;
        return { ...p, customFields: rest };
      })
    );
  }, []);

  const handleCopyFromAbove = useCallback((productId: string) => {
    setProducts(prev => {
        const productIndex = prev.findIndex(p => p.id === productId);

        if (productIndex < 1) { // Can't copy if it's the first item
            return prev;
        }

        const sourceProduct = prev[productIndex - 1];
        
        return prev.map((p, index) => {
            if (index === productIndex) {
                return {
                    ...p,
                    url: sourceProduct.url,
                    category: sourceProduct.category,
                    quoteTemplateId: sourceProduct.quoteTemplateId,
                    manufacturer: sourceProduct.manufacturer,
                    productName: sourceProduct.productName,
                    costPrice: sourceProduct.costPrice,
                    supplyPrice: sourceProduct.supplyPrice,
                    sellingPrice: sourceProduct.sellingPrice,
                    margin: sourceProduct.margin,
                    searchKeyword: sourceProduct.searchKeyword,
                    sku: sourceProduct.sku,
                    barcode: generateBarcodeNumber(),
                    sizeWidth: sourceProduct.sizeWidth,
                    sizeHeight: sourceProduct.sizeHeight,
                    sizeDepth: sourceProduct.sizeDepth,
                    weight: sourceProduct.weight,
                    quantity: sourceProduct.quantity,
                    detailFile: sourceProduct.detailFile,
                    detailDataUrl: sourceProduct.detailDataUrl,
                    material: sourceProduct.material,
                    countryOfOrigin: sourceProduct.countryOfOrigin,
                    importer: sourceProduct.importer,
                    recommendedAge: sourceProduct.recommendedAge,
                    asContact: sourceProduct.asContact,
                    cautionNote: sourceProduct.cautionNote,
                };
            }
            return p;
        });
    });
    const productIndex = products.findIndex(p => p.id === productId);
    if (productIndex > 0) {
      expandProductGroup(products[productIndex - 1].id);
    }
  }, [products, expandProductGroup]);

  const handleGenerateProposalExcel = useCallback(async () => {
    if (isExporting) return;
    setIsExporting(true);

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'Product Manager App';
        workbook.created = new Date();
        
        const worksheet = workbook.addWorksheet('제안상품목록');

        const headers = [
            { header: '카테고리', key: 'category', width: 12 },
            { header: '썸네일', key: 'thumbnail', width: 15 },
            { header: 'URL', key: 'url', width: 12 },
            { header: '상품명', key: 'productName', width: 40 },
            { header: '제조사', key: 'manufacturer', width: 25 },
            { header: '원가', key: 'costPrice', width: 18 },
            { header: '공급가', key: 'supplyPrice', width: 18 },
            { header: '판매가', key: 'sellingPrice', width: 18 },
            { header: '마진', key: 'margin', width: 18 },
            { header: '마진율', key: 'marginRate', width: 12 },
        ];
        worksheet.columns = headers;

        const headerRow = worksheet.getRow(1);
        headerRow.height = 30;
        headerRow.eachCell(cell => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            cell.font = { bold: true, size: 12, color: { argb: 'FF000000' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        for (const [index, product] of products.entries()) {
            const rowIndex = index + 2;
            
            const costPrice = Number(product.costPrice) || 0;
            const supplyPrice = Number(product.supplyPrice) || 0;
            const margin = supplyPrice - costPrice;
            const marginRate = supplyPrice > 0 ? margin / supplyPrice : 0;

            const rowData = {
                category: product.category,
                url: product.url,
                productName: product.productName,
                manufacturer: product.manufacturer,
                costPrice: costPrice,
                supplyPrice: supplyPrice,
                sellingPrice: Number(product.sellingPrice) || 0,
                margin: margin,
                marginRate: marginRate,
            };

            const row = worksheet.addRow(rowData);
            row.height = 75;
            
            if (product.thumbnailDataUrl && product.thumbnailDataUrl.startsWith('data:image')) {
              try {
                  const dataUrlParts = product.thumbnailDataUrl.split(',');
                  const mimeTypePart = dataUrlParts[0];
                  const base64Data = dataUrlParts[1];
                  
                  const extensionMatch = mimeTypePart.match(/data:image\/(.+);/);
                  const extension = (extensionMatch ? extensionMatch[1] : 'png') as 'jpeg' | 'png' | 'gif';

                  if(base64Data && extension) {
                    const imageId = workbook.addImage({
                        base64: base64Data,
                        extension: extension,
                    });
                    worksheet.addImage(imageId, {
                        tl: { col: 1.2, row: rowIndex - 1 + 0.2 },
                        ext: { width: 90, height: 90 }
                    });
                  }
              } catch (e) {
                  console.error(`Failed to process image for product ${product.productName}:`, e);
                  worksheet.getCell(`B${rowIndex}`).value = '이미지\n오류';
              }
            } else {
               worksheet.getCell(`B${rowIndex}`).value = '이미지\n없음';
            }

            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const headerKey = headers[colNumber - 1].key;
                const isPriceColumn = ['costPrice', 'supplyPrice', 'sellingPrice', 'margin'].includes(headerKey);
                const isUrlColumn = ['url'].includes(headerKey);
                const isRateColumn = headerKey === 'marginRate';
                
                cell.alignment = { 
                    vertical: 'middle', 
                    horizontal: isPriceColumn || isRateColumn ? 'right' : 'left', 
                    wrapText: !isUrlColumn, 
                    indent: 1 
                };

                if (colNumber === 2) cell.alignment.horizontal = 'center';
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                if (isPriceColumn) {
                    cell.numFmt = '#,##0 "원"';
                } else if (isRateColumn) {
                    cell.numFmt = '0.00%';
                }
            });
        }
        
        if (products.length > 0) {
            worksheet.addRow([]); // spacer
            const totalRowIndex = products.length + 3;
            const totalRow = worksheet.getRow(totalRowIndex);
            totalRow.height = 25;
            
            const totalLabelCell = worksheet.getCell(`E${totalRowIndex}`);
            totalLabelCell.value = '합계';
            totalLabelCell.font = { bold: true, size: 12 };
            totalLabelCell.alignment = { vertical: 'middle', horizontal: 'center' };
            totalLabelCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };


            const priceColumns = ['F', 'G', 'H', 'I'];
            priceColumns.forEach(col => {
                const cell = worksheet.getCell(`${col}${totalRowIndex}`);
                cell.value = { formula: `SUM(${col}2:${col}${products.length + 1})` };
                cell.numFmt = '#,##0 "원"';
                cell.font = { bold: true };
                cell.alignment = { vertical: 'middle', horizontal: 'right', indent: 1 };
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `제안상품목록_${new Date().toISOString().slice(0,10)}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

    } catch (error) {
        console.error("Failed to generate Excel file:", error);
        alert("엑셀 파일 생성에 실패했습니다.");
    } finally {
        setIsExporting(false);
    }
  }, [products, isExporting]);

  const handleGenerateSampleExcel = useCallback(async () => {
    if (isSampleExporting) return;
    setIsSampleExporting(true);

    try {
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('상품등록양식');

        const headerRow1 = [
            null, '상품기본정보', null, null, null, null, null, null, null, // B-I
            '노출속성', // J
            '상품이미지정보', null, null, null, // K-N
            '상품가격정보', null, null, null, // O-R
            '상품부가정보', null, null, null, null, // S-W
            '물류입고정보', null, null, null, // X-AA
            '상품인증정보', null, null, null, null, // AB-AF
            '상품법적정보', ...Array(15).fill(null) // AG-AU
        ];
        
        const headerRow2 = [
            null, '상품명', 'URL', '상품 바코드', '모델명', '검색어', '브랜드', '색상', '수량', null,
            '대표이미지명', '상세이미지명', '이미지대체텍스트', null,
            '공급가', '판매가', '권장소비자가', '과세',
            '제조사', '거래타입', '수입여부', 'sku', null,
            '유통기한', '취급주의', '중량', '사이즈',
            '인증1', '인증2', '인증3', '인증4', '라벨',
            '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15'
        ];
        
        worksheet.addRow(headerRow1);
        worksheet.addRow(headerRow2);

        worksheet.mergeCells('B1:I1');
        worksheet.mergeCells('K1:N1');
        worksheet.mergeCells('O1:R1');
        worksheet.mergeCells('S1:W1');
        worksheet.mergeCells('X1:AA1');
        worksheet.mergeCells('AB1:AF1');
        worksheet.mergeCells('AG1:AU1');

        const header1Style = {
            font: { color: { argb: 'FFFFFFFF' }, bold: true, size: 12 },
            alignment: { vertical: 'middle', horizontal: 'center' },
            border: { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } }
        };
        const applyStyleToMergedRange = (range: string, style: object, fillColor: string) => {
            const [start] = range.split(':');
            const cell = worksheet.getCell(start);
            cell.style = style;
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
        };
        
        applyStyleToMergedRange('B1:I1', header1Style, 'FF4472C4');
        worksheet.getCell('J1').style = header1Style;
        worksheet.getCell('J1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };

        applyStyleToMergedRange('K1:N1', header1Style, 'FF70AD47');
        applyStyleToMergedRange('O1:R1', header1Style, 'FF70AD47');
        applyStyleToMergedRange('S1:W1', header1Style, 'FF70AD47');
        applyStyleToMergedRange('X1:AA1', header1Style, 'FF70AD47');
        applyStyleToMergedRange('AB1:AF1', header1Style, 'FFFF0000');
        applyStyleToMergedRange('AG1:AU1', header1Style, 'FF4472C4');


        const row2 = worksheet.getRow(2);
        row2.height = 25;
        row2.eachCell({ includeEmpty: true }, cell => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFF00' } };
            cell.font = { bold: true };
            cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        const columnWidths = [5, 30, 40, 30, 30, 20, 15, 10, 10, 5, 20, 20, 30, 5, 15, 15, 15, 10, 20, 15, 15, 15, 5, 15, 15, 15, 20, 15, 15, 15, 15, 20, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
        columnWidths.forEach((width, index) => {
            if (worksheet.getColumn(index + 1)) worksheet.getColumn(index + 1).width = width;
        });

        products.forEach(product => {
            const sizeString = [product.sizeWidth, product.sizeHeight, product.sizeDepth].filter(Boolean).join('*');
            const weightString = product.weight ? `${product.weight}g` : '';
            
            let labelFileName = '';
            if (product.detailFile) {
                const lastDotIndex = product.detailFile.lastIndexOf('.');
                const baseName = lastDotIndex !== -1 ? product.detailFile.substring(0, lastDotIndex) : product.detailFile;
                labelFileName = `${baseName}_l.png`;
            }

            const combinedProductName = [product.productName, product.color].filter(Boolean).join(', ');

            const rowData = [
                null,
                combinedProductName,
                product.url,
                '바코드 없음(쿠팡 바코드 생성 요청)',
                product.productName,
                product.searchKeyword,
                '주노엘',
                product.color,
                `${product.quantity || 1}개`,
                null,
                product.thumbnailFile,
                product.detailFile,
                product.productName,
                null,
                Number(product.supplyPrice) || '',
                Number(product.sellingPrice) || '',
                '',
                '과세',
                '주노엘 협력업체',
                '제조사',
                '수입상품',
                product.sku,
                null,
                '0',
                '해당사항없음',
                weightString,
                sizeString,
                '해당사항없음',
                '해당사항없음',
                '해당사항없음',
                '해당사항없음',
                labelFileName,
                ...Array(15).fill('상세페이지 참조')
            ];
            
            const row = worksheet.addRow(rowData);
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                cell.alignment = { vertical: 'middle', horizontal: 'left', indent: colNumber > 1 ? 1 : 0, wrapText: true };
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `상품등록샘플_${new Date().toISOString().slice(0,10)}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (error) {
        console.error("Failed to generate sample Excel file:", error);
        alert("샘플 엑셀 파일 생성에 실패했습니다.");
    } finally {
        setIsSampleExporting(false);
    }
}, [products, isSampleExporting]);


  const openLabelModal = useCallback((product: Product) => {
    setCurrentProductForLabel(product);
    setIsLabelModalOpen(true);
    setGeneratedLabelImage(null);
  }, []);

  const closeLabelModal = useCallback(() => {
    setIsLabelModalOpen(false);
    setCurrentProductForLabel(null);
    setGeneratedLabelImage(null);
  }, []);

  const downloadImage = useCallback(() => {
    if (!generatedLabelImage) return;
    saveDataUrlInProductFolder(
      generatedLabelImage,
      productFolderName(currentProductForLabel),
      currentProductForLabel?.labelFile || `${currentProductForLabel?.productName || 'product'}_label.png`
    );
  }, [generatedLabelImage, currentProductForLabel]);

  useEffect(() => {
    const generateLabel = async () => {
      if (currentProductForLabel && isLabelModalOpen && labelRef.current) {
        setIsGenerating(true);
        try {
          const canvas = await html2canvas(labelRef.current, { scale: 2, backgroundColor: null });
          setGeneratedLabelImage(canvas.toDataURL('image/png'));
        } catch (error) {
          console.error("Error generating image:", error);
          alert("이미지 생성에 실패했습니다.");
        } finally {
          setIsGenerating(false);
        }
      }
    };

    if (currentProductForLabel && isLabelModalOpen) {
      setTimeout(generateLabel, 100);
    }
  }, [currentProductForLabel, isLabelModalOpen]);

  const openBarcodeLabelModal = useCallback((product: Product) => {
    setCurrentProductForBarcodeLabel(product);
    setIsBarcodeLabelModalOpen(true);
    setGeneratedBarcodeLabelImage(null);
  }, []);

  const closeBarcodeLabelModal = useCallback(() => {
    setIsBarcodeLabelModalOpen(false);
    setCurrentProductForBarcodeLabel(null);
    setGeneratedBarcodeLabelImage(null);
  }, []);

  const downloadBarcodeLabelImage = useCallback(() => {
    if (!generatedBarcodeLabelImage) return;
    saveDataUrlInProductFolder(
      generatedBarcodeLabelImage,
      productFolderName(currentProductForBarcodeLabel),
      `${currentProductForBarcodeLabel?.productName || 'product'}_바코드라벨.png`
    );
  }, [generatedBarcodeLabelImage, currentProductForBarcodeLabel]);

  useEffect(() => {
    const generateBarcodeLabel = async () => {
      if (currentProductForBarcodeLabel && isBarcodeLabelModalOpen && barcodeLabelRef.current) {
        setIsGeneratingBarcodeLabel(true);
        try {
          const canvas = await html2canvas(barcodeLabelRef.current, { scale: 2, backgroundColor: null });
          setGeneratedBarcodeLabelImage(canvas.toDataURL('image/png'));
        } catch (error) {
          console.error("Error generating barcode label image:", error);
          alert("바코드 라벨 이미지 생성에 실패했습니다.");
        } finally {
          setIsGeneratingBarcodeLabel(false);
        }
      }
    };

    if (currentProductForBarcodeLabel && isBarcodeLabelModalOpen) {
      setTimeout(generateBarcodeLabel, 100);
    }
  }, [currentProductForBarcodeLabel, isBarcodeLabelModalOpen]);

  // Renders the given product into the off-screen ProductLabel (mounted below) and captures it with
  // html2canvas, resolving with the resulting data URL — used by 통합다운 to grab the "라벨" image
  // without opening the visible label modal.
  const captureLabelImage = useCallback((product: Product): Promise<string | null> => {
    return new Promise(resolve => {
      labelCaptureResolveRef.current = resolve;
      setLabelCaptureProduct(product);
    });
  }, []);

  useEffect(() => {
    if (!labelCaptureProduct) return;
    let cancelled = false;
    (async () => {
      await new Promise(r => setTimeout(r, 100));
      if (cancelled || !hiddenLabelCaptureRef.current) {
        labelCaptureResolveRef.current?.(null);
        labelCaptureResolveRef.current = null;
        setLabelCaptureProduct(null);
        return;
      }
      try {
        const canvas = await html2canvas(hiddenLabelCaptureRef.current, { scale: 2, backgroundColor: null });
        labelCaptureResolveRef.current?.(canvas.toDataURL('image/png'));
      } catch (error) {
        console.error('라벨 이미지 생성 실패 (통합다운):', error);
        labelCaptureResolveRef.current?.(null);
      } finally {
        labelCaptureResolveRef.current = null;
        setLabelCaptureProduct(null);
      }
    })();
    return () => { cancelled = true; };
  }, [labelCaptureProduct]);

  const openMarginCalculator = useCallback((productId: string) => {
    setMarginCalculatorState({ isOpen: true, productId: productId });
  }, []);

  const closeMarginCalculator = useCallback(() => {
      setMarginCalculatorState({ isOpen: false, productId: null });
  }, []);

  const handleSaveMarginCalculator = useCallback((data: { costPrice: string; supplyPrice: string; sellingPrice: string; margin: string; }) => {
      if (marginCalculatorState.productId === null) return;
      
      const productId = marginCalculatorState.productId;
      setProducts(prev => prev.map(p => 
        p.id === productId ? { 
            ...p,
            costPrice: data.costPrice,
            supplyPrice: data.supplyPrice,
            sellingPrice: data.sellingPrice,
            margin: data.margin,
        } : p
      ));

      closeMarginCalculator();
  }, [marginCalculatorState.productId, closeMarginCalculator]);

  const handleSaveQuoteFixedValues = useCallback((values: QuoteFixedValues) => {
    setQuoteFixedValues(values);
    try {
      localStorage.setItem('quoteFixedValues', JSON.stringify(values));
    } catch (error) {
      console.error("Failed to save quote fixed values to localStorage", error);
    }
  }, []);

  // 카테고리는 견적서와 독립적으로 저장/관리됩니다. 이 함수로 추가된 카테고리는
  // handleDeleteCategory를 통해 사용자가 직접 삭제하기 전까지는 절대 사라지지 않습니다.
  const handleRegisterCategory = useCallback((category: string) => {
    const trimmed = category.trim();
    if (!trimmed) return;

    setCategories(prev => {
      if (prev.includes(trimmed)) return prev;
      const next = [...prev, trimmed];
      try {
        localStorage.setItem('categories', JSON.stringify(next));
      } catch (error) {
        console.error("Failed to save categories to localStorage", error);
      }
      return next;
    });
  }, []);

  const handleDeleteCategory = useCallback((category: string) => {
    setCategories(prev => {
      const next = prev.filter(c => c !== category);
      try {
        localStorage.setItem('categories', JSON.stringify(next));
      } catch (error) {
        console.error("Failed to save categories to localStorage", error);
      }
      return next;
    });
  }, []);

  const handleAddQuoteTemplateRegistration = useCallback((category: string, file: File, customFieldNames: string[], optionFieldName: string) => {
    const reader = new FileReader();
    reader.onloadend = async () => {
      if (!reader.result) return;

      // 노출속성 기본 양식이 지정돼 있으면, 그 견적서와 이번에 새로 등록하는 견적서의 노출속성
      // 항목(색상/수량/높이 등)을 비교해서 기본 양식에는 없는 항목만 추가 항목 이름에 자동으로
      // 더해줍니다. 카테고리마다 노출속성 개수가 달라서, 사람이 매번 직접 등록하지 않아도 되게 합니다.
      let finalCustomFieldNames = customFieldNames;
      try {
        const baseReg = quoteTemplateRegistrations.find(r => r.isExposureBaseTemplate);
        const template = getQuoteTemplates(quoteFixedValues)[0];
        if (baseReg && template) {
          const newBuffer = dataUrlToArrayBuffer(reader.result as string);
          const baseBuffer = dataUrlToArrayBuffer(baseReg.fileDataUrl);
          const [baseLabels, newLabels] = await Promise.all([
            extractExposureAttributeLabels(baseBuffer, template),
            extractExposureAttributeLabels(newBuffer, template),
          ]);
          const extraLabels = findNewExposureAttributeLabels(baseLabels, newLabels).filter(
            label => !finalCustomFieldNames.some(existing => normalizeHeader(existing) === normalizeHeader(label))
          );
          if (extraLabels.length > 0) finalCustomFieldNames = [...finalCustomFieldNames, ...extraLabels];
        }
      } catch (error) {
        console.error("Failed to compare exposure attribute columns against base template", error);
      }

      const newRegistration: QuoteTemplateRegistration = {
        id: generateId(),
        category,
        fileName: file.name,
        fileDataUrl: reader.result as string,
        customFieldNames: finalCustomFieldNames,
        optionFieldName,
        createdAt: Date.now(),
      };

      try {
        // IndexedDB에 먼저 확실히 저장한 뒤에만 화면 상태와 카테고리를 반영합니다.
        // 저장에 실패하면(예: 저장 공간 부족) 조용히 사라지지 않고 바로 알려줍니다.
        await putQuoteTemplate(newRegistration);
        setQuoteTemplateRegistrations(prev => [...prev, newRegistration]);
        // 견적서를 나중에 삭제하더라도 카테고리는 레지스트리에 남아있도록 별도로 등록합니다.
        handleRegisterCategory(category);
      } catch (error) {
        console.error("Failed to save quote template to IndexedDB", error);
        alert(`견적서 저장에 실패했습니다. 새로고침하면 이 견적서는 사라집니다.\n오류: ${error instanceof Error ? error.message : String(error)}`);
      }
    };
    reader.onerror = () => {
      console.error("Failed to read quote template file", reader.error);
      alert('견적서 파일을 읽는 데 실패했습니다.');
    };
    reader.readAsDataURL(file);
  }, [handleRegisterCategory, quoteTemplateRegistrations, quoteFixedValues]);

  // 견적서 목록에서 하나를 "노출속성 기본 양식"으로 지정합니다. 항상 한 개만 지정될 수 있도록
  // 이전에 지정돼 있던 견적서는 자동으로 해제됩니다.
  const handleSetExposureBaseTemplate = useCallback((id: string) => {
    setQuoteTemplateRegistrations(prev => {
      const changed: QuoteTemplateRegistration[] = [];
      const updated = prev.map(r => {
        const nextFlag = r.id === id;
        if (!!r.isExposureBaseTemplate === nextFlag) return r;
        const next = { ...r, isExposureBaseTemplate: nextFlag };
        changed.push(next);
        return next;
      });
      changed.forEach(r => {
        putQuoteTemplate(r).catch(error => {
          console.error("Failed to update exposure base template flag in IndexedDB", error);
          alert(`기본 양식 지정에 실패했습니다.\n오류: ${error instanceof Error ? error.message : String(error)}`);
        });
      });
      return updated;
    });
  }, []);

  const handleUpdateQuoteTemplateCustomFieldNames = useCallback((id: string, customFieldNames: string[]) => {
    setQuoteTemplateRegistrations(prev => {
      const target = prev.find(r => r.id === id);
      if (!target) return prev;
      const updated = { ...target, customFieldNames };

      putQuoteTemplate(updated).catch(error => {
        console.error("Failed to update quote template in IndexedDB", error);
        alert(`견적서 항목 수정에 실패했습니다.\n오류: ${error instanceof Error ? error.message : String(error)}`);
      });

      return prev.map(r => (r.id === id ? updated : r));
    });
  }, []);

  const handleUpdateQuoteTemplateOptionFieldName = useCallback((id: string, optionFieldName: string) => {
    setQuoteTemplateRegistrations(prev => {
      const target = prev.find(r => r.id === id);
      if (!target) return prev;
      const updated = { ...target, optionFieldName };

      putQuoteTemplate(updated).catch(error => {
        console.error("Failed to update quote template in IndexedDB", error);
        alert(`견적서 항목 수정에 실패했습니다.\n오류: ${error instanceof Error ? error.message : String(error)}`);
      });

      return prev.map(r => (r.id === id ? updated : r));
    });
  }, []);

  // 견적서 삭제는 등록된 카테고리 목록에 영향을 주지 않습니다. 카테고리는 오직
  // handleDeleteCategory를 통해서만, 즉 사용자가 명시적으로 삭제할 때만 사라집니다.
  const handleDeleteQuoteTemplateRegistration = useCallback(async (id: string) => {
    try {
      await deleteQuoteTemplate(id);
      setQuoteTemplateRegistrations(prev => {
        const target = prev.find(r => r.id === id);
        const namesToRemove = target?.customFieldNames || [];

        setProducts(prevProducts => prevProducts.map(p => {
          if (p.quoteTemplateId !== id) return p;
          const nextCustomFields = { ...p.customFields };
          namesToRemove.forEach(name => delete nextCustomFields[name]);
          return { ...p, quoteTemplateId: '', customFields: nextCustomFields };
        }));

        return prev.filter(r => r.id !== id);
      });
    } catch (error) {
      console.error("Failed to delete quote template from IndexedDB", error);
      alert(`견적서 삭제에 실패했습니다.\n오류: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  // 같은 카테고리로 여러 번 등록된 견적서 중, 카테고리별로 가장 최근(createdAt) 것 하나만
  // 남기고 나머지를 지웁니다. createdAt이 없는 구버전 항목들만 있는 카테고리는 현재 목록
  // 순서상 마지막 항목을 최신으로 간주합니다.
  const handleCleanupDuplicateQuoteTemplates = useCallback(async () => {
    const byCategory = new Map<string, QuoteTemplateRegistration[]>();
    quoteTemplateRegistrations.forEach(r => {
      const list = byCategory.get(r.category) || [];
      list.push(r);
      byCategory.set(r.category, list);
    });

    const idsToDelete: string[] = [];
    byCategory.forEach(list => {
      if (list.length <= 1) return;
      const keeper = list.reduce((latest, cur) => {
        const latestTime = latest.createdAt ?? -1;
        const curTime = cur.createdAt ?? -1;
        return curTime >= latestTime ? cur : latest;
      });
      list.forEach(r => {
        if (r.id !== keeper.id) idsToDelete.push(r.id);
      });
    });

    if (idsToDelete.length === 0) {
      alert('정리할 중복 견적서가 없습니다.');
      return;
    }

    if (!window.confirm(`카테고리별로 최신 견적서 1개만 남기고 ${idsToDelete.length}개를 삭제하시겠습니까?\n(상품에서 삭제되는 견적서를 사용 중이었다면 선택이 해제됩니다.)`)) {
      return;
    }

    try {
      for (const id of idsToDelete) {
        await deleteQuoteTemplate(id);
      }
      const deletedIds = new Set(idsToDelete);
      setQuoteTemplateRegistrations(prev => {
        const removedNames = new Map<string, string[]>();
        prev.forEach(r => {
          if (deletedIds.has(r.id)) removedNames.set(r.id, r.customFieldNames || []);
        });

        setProducts(prevProducts => prevProducts.map(p => {
          if (!p.quoteTemplateId || !deletedIds.has(p.quoteTemplateId)) return p;
          const nextCustomFields = { ...p.customFields };
          (removedNames.get(p.quoteTemplateId) || []).forEach(name => delete nextCustomFields[name]);
          return { ...p, quoteTemplateId: '', customFields: nextCustomFields };
        }));

        return prev.filter(r => !deletedIds.has(r.id));
      });
    } catch (error) {
      console.error("Failed to clean up duplicate quote templates from IndexedDB", error);
      alert(`중복 견적서 정리에 실패했습니다.\n오류: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [quoteTemplateRegistrations]);

  const runGenerateProductQuote = useCallback(async (productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    if (!product.quoteTemplateId) {
      alert('먼저 이 상품에 사용할 견적서를 선택해주세요.');
      return;
    }

    const registration = quoteTemplateRegistrations.find(r => r.id === product.quoteTemplateId);
    if (!registration) {
      alert('선택된 견적서를 찾을 수 없습니다. 견적서를 다시 선택해주세요.');
      return;
    }

    // 옵션(색상 등)이 여러 개면 같은 URL 그룹의 옵션 전체를 한 견적서 파일에 옵션당 한 행씩
    // 함께 채운다(fillQuoteWorkbook은 products 배열 순서대로 dataStartRowNumber부터 한 행씩 씀).
    const groupKey = getProductGroupKey(product);
    const groupProducts = withSharedGroupFiles(products.filter(p => getProductGroupKey(p) === groupKey));

    setGeneratingProductQuoteId(productId);
    try {
      const template = getQuoteTemplates(quoteFixedValues)[0];
      if (!template) {
        throw new Error('사용 가능한 견적서 양식이 없습니다.');
      }

      const arrayBuffer = dataUrlToArrayBuffer(registration.fileDataUrl);

      // 이 견적서 파일이 필수로 요구하는 항목 중, 아직 상품에 없는 항목(예: 출시 연도, 계절)이
      // 있으면 자동으로 추가 항목 칸을 만들어줍니다. (출시 연도처럼 자동으로 정할 수 있는 값은
      // 바로 채우고, 나머지는 빈 채로 만들어 상품 행에서 바로 입력할 수 있게 합니다.)
      const ensuredProducts = await ensureRequiredCustomFields(arrayBuffer, template, groupProducts);
      const changedProducts = ensuredProducts.filter((p, i) => p !== groupProducts[i]);
      if (changedProducts.length > 0) {
        const changedById = new Map(changedProducts.map(p => [p.id, p]));
        setProducts(prev => prev.map(p => changedById.get(p.id) ?? p));
      }

      const requiredGaps = await findMissingRequiredCells(arrayBuffer, template, ensuredProducts);
      if (requiredGaps.length > 0) {
        setRequiredFieldGaps(requiredGaps);
        return;
      }

      const buffer = await fillQuoteWorkbook(arrayBuffer, template, ensuredProducts);

      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${product.productName || '상품'}_견적서_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // 그룹 안에서 라벨 이미지를 가진 옵션들을 순서대로 이어서 내려받는다(견적서 파일은 하나지만
      // 라벨은 옵션마다 바코드/SKU가 달라 옵션별로 따로 필요하다).
      const labelTargets = ensuredProducts.filter(p => p.labelDataUrl);
      labelTargets.forEach((p, i) => {
        const labelExt = p.labelFile.split('.').pop()?.split(/[?#]/)[0] || p.labelDataUrl!.match(/^data:image\/(\w+);/)?.[1] || 'png';
        setTimeout(() => {
          const labelLink = document.createElement('a');
          labelLink.href = p.labelDataUrl as string;
          labelLink.download = `${p.productName || '상품'}_라벨.${labelExt}`;
          document.body.appendChild(labelLink);
          labelLink.click();
          document.body.removeChild(labelLink);
        }, 300 * (i + 1));
      });
    } catch (error) {
      console.error("Failed to generate product quote:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`견적서 생성에 실패했습니다: ${errorMessage}`);
    } finally {
      setGeneratingProductQuoteId(null);
    }
  }, [products, quoteTemplateRegistrations, quoteFixedValues]);

  const handleGenerateProductQuote = useCallback((productId: string) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    // 견적서가 옵션 그룹 전체를 한 파일로 채우므로(runGenerateProductQuote 참고), 필수 항목도
    // 클릭한 옵션 하나가 아니라 그룹 전체를 대상으로 확인한다.
    const groupKey = getProductGroupKey(product);
    const groupProducts = products.filter(p => getProductGroupKey(p) === groupKey);
    if (collectMissingFields(groupProducts).length > 0) {
      setMissingFieldsProductId(productId);
      return;
    }

    runGenerateProductQuote(productId);
  }, [products, runGenerateProductQuote]);

  // 통합다운: 상품명 폴더 안에 라벨이미지, 견적서를 그대로, 대표/상세 이미지는 압축(zip)해서 함께 저장.
  // 각 항목은 준비된 것만 담고, 없는 항목(견적서 템플릿 미선택, 라벨/이미지 없음 등)은 조용히 건너뛴다.
  // 클릭한 옵션 하나가 아니라 같은 URL 그룹의 옵션 전체를 대상으로 한다: 견적서는 옵션당 한 행씩
  // 그룹 전체가 한 파일에(runGenerateProductQuote와 동일한 방식), 대표이미지·라벨은 옵션마다 SKU/
  // 색상이 달라 옵션별로 하나씩, 상세이미지는 그룹 전체가 공유하는 한 장이라 한 번만 담는다.
  const handleIntegratedDownload = useCallback(async (productId: string) => {
    if (integratedDownloadingId) return;
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const groupKey = getProductGroupKey(product);
    const groupProducts = withSharedGroupFiles(products.filter(p => getProductGroupKey(p) === groupKey));

    setIntegratedDownloadingId(productId);
    try {
      // 폴더 접근 권한을 클릭 직후 가장 먼저 요청한다. showDirectoryPicker/showSaveFilePicker는
      // "user activation"이 있어야 동작하는데, 라벨 캡처·zip 압축·엑셀 생성처럼 시간이 걸리는
      // 비동기 작업을 먼저 거치면 그 활성 상태가 소멸해 조용히 실패(버튼 클릭해도 무반응)한다.
      await getRootDirectory();

      const files: { name: string; blob: Blob }[] = [];

      // 라벨: 옵션마다 하나씩 순서대로 생성한다(캡처가 숨은 DOM 노드 하나를 재사용하므로 동시에
      // 여러 개를 캡처할 수 없어 순차적으로 처리).
      for (const p of groupProducts) {
        const labelImageDataUrl = await captureLabelImage(p);
        if (labelImageDataUrl) {
          const labelBlob = await (await fetch(labelImageDataUrl)).blob();
          files.push({ name: p.labelFile || `${p.productName || '상품'}_라벨.png`, blob: labelBlob });
        }
      }

      // 이미지: 대표이미지는 옵션마다, 상세이미지는 그룹이 공유하는 한 장만 함께 압축한다.
      const imageFiles: { name: string; blob: Blob }[] = [];
      for (const p of groupProducts) {
        if (p.thumbnailDataUrl) {
          imageFiles.push({ name: p.thumbnailFile || `${p.productName || '대표'}.png`, blob: await (await fetch(p.thumbnailDataUrl)).blob() });
        }
      }
      if (product.detailDataUrl) {
        imageFiles.push({ name: product.detailFile || '상세.png', blob: await (await fetch(product.detailDataUrl)).blob() });
      }
      if (imageFiles.length > 0) {
        const zipBlob = await buildZipBlob(imageFiles);
        files.push({ name: `${product.productName || '상품'}_이미지.zip`, blob: zipBlob });
      }

      if (product.quoteTemplateId) {
        const registration = quoteTemplateRegistrations.find(r => r.id === product.quoteTemplateId);
        if (registration) {
          try {
            const template = getQuoteTemplates(quoteFixedValues)[0];
            if (template) {
              const arrayBuffer = dataUrlToArrayBuffer(registration.fileDataUrl);
              const buffer = await fillQuoteWorkbook(arrayBuffer, template, groupProducts);
              const quoteBlob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
              files.push({
                name: `${product.productName || '상품'}_견적서_${new Date().toISOString().slice(0, 10)}.xlsx`,
                blob: quoteBlob,
              });
            }
          } catch (error) {
            console.error('견적서 생성 실패 (통합다운):', error);
          }
        }
      }

      if (files.length === 0) {
        alert('다운로드할 파일이 없습니다. (라벨/이미지/견적서 중 준비된 항목이 없습니다)');
        return;
      }

      await saveFilesInProductFolder(productNameFolderName(product), files);
      // 폴더 접근 권한이 이미 있으면 저장이 다이얼로그 없이 조용히 끝나서 사용자 눈에는 버튼이
      // 반응하지 않은 것처럼 보일 수 있다. 잠깐 체크 아이콘으로 바꿔 완료됐다는 걸 알려준다.
      setIntegratedDownloadDoneId(productId);
      setTimeout(() => setIntegratedDownloadDoneId(prev => (prev === productId ? null : prev)), 1500);
    } catch (error) {
      console.error('통합 다운로드 실패:', error);
      alert('통합 다운로드 중 오류가 발생했습니다.');
    } finally {
      setIntegratedDownloadingId(null);
    }
  }, [products, quoteTemplateRegistrations, quoteFixedValues, integratedDownloadingId, captureLabelImage]);

  const handleImportProductQuote = useCallback(async (productId: string, file: File) => {
    setImportingProductQuoteId(productId);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(arrayBuffer);

      const template = getQuoteTemplates(quoteFixedValues)[0];
      if (!template) {
        throw new Error('사용 가능한 견적서 양식이 없습니다.');
      }

      const product = products.find(p => p.id === productId);
      const customFieldNames = Object.keys(product?.customFields || {});
      const extracted = parseQuoteWorkbookToProduct(workbook, template, customFieldNames);

      if (Object.keys(extracted).length === 0) {
        alert('파일에서 추출할 수 있는 값을 찾지 못했습니다. 이 상품에서 생성한 견적서 파일이 맞는지 확인해주세요.');
        return;
      }

      setProducts(prev => prev.map(p => {
        if (p.id !== productId) return p;
        const { customFields, ...rest } = extracted;
        return {
          ...p,
          ...rest,
          ...(customFields ? { customFields: { ...p.customFields, ...customFields } } : {}),
        };
      }));
    } catch (error) {
      console.error("Failed to import product quote:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`견적서 파일에서 값을 불러오지 못했습니다: ${errorMessage}`);
    } finally {
      setImportingProductQuoteId(null);
    }
  }, [products, quoteFixedValues]);

  const handleToggle1688AiTranslation = useCallback(() => {
    setUse1688AiTranslation(prev => {
      const next = !prev;
      localStorage.setItem('use1688AiTranslation', next ? '1' : '0');
      return next;
    });
  }, []);

  // 1688 캡처 확장프로그램이 클립보드에 복사해둔 JSON을 읽어와 상품 필드에 채워 넣습니다.
  // 옵션(variants)이 여러 개면 그 개수만큼 상품행을 복제해서, 공통 필드(URL/SKU/중량/상품명/
  // 제조사/검색어)는 모든 행에 동일하게, 옵션별 원가/사이즈/노출속성만 행마다 다르게 채웁니다.
  // AI(Gemini) 호출은 옵션이 몇 개든 딱 1번만 발생합니다.
  const handleImportFrom1688 = useCallback(async (productId: string) => {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      alert('이 브라우저 탭에서는 클립보드 읽기를 사용할 수 없습니다.\n주소창의 URL이 http://localhost:3000 또는 https://로 시작하는지 확인해주세요. (192.168.x.x 같은 일반 HTTP 주소에서는 보안 정책상 클립보드 API가 동작하지 않습니다.)');
      return;
    }

    let payload: any;
    try {
      const clipboardText = await navigator.clipboard.readText();
      payload = JSON.parse(clipboardText);
    } catch (error) {
      alert('클립보드에서 1688 데이터를 찾지 못했습니다. 1688 상품 페이지에서 캡처 확장프로그램 버튼을 먼저 눌러주세요.');
      return;
    }

    if (!payload || payload.source !== '1688-import') {
      alert('클립보드 내용이 1688 캡처 데이터 형식이 아닙니다. 1688 페이지에서 캡처 버튼을 먼저 눌러주세요.');
      return;
    }

    const product = products.find(p => p.id === productId);
    if (!product) return;

    // 구버전 확장프로그램은 옵션 배열 없이 colorRaw/priceCny/sizeCm을 최상위에 그대로 보낸다.
    // 그 경우 옵션 1개짜리 배열로 취급해서 아래 로직을 그대로 재사용한다.
    // costPriceKrw/supplyPriceKrw/sellingPriceKrw/marginKrw는 확장프로그램의 "1688 캡처" 창에서
    // 수익 계산기(환율/마진율)를 함께 채웠을 때만 온다. 있으면 priceCny×환율 대신 이 값을 그대로 쓴다.
    const variants: Array<{
      colorRaw?: string;
      priceCny?: number | null;
      sizeCm?: { width?: number | null; height?: number | null; depth?: number | null } | null;
      costPriceKrw?: number | null;
      supplyPriceKrw?: number | null;
      sellingPriceKrw?: number | null;
      marginKrw?: number | null;
    }> =
      Array.isArray(payload.variants) && payload.variants.length > 0
        ? payload.variants
        : [{ colorRaw: payload.colorRaw || '', priceCny: typeof payload.priceCny === 'number' ? payload.priceCny : null, sizeCm: payload.sizeCm || null }];

    const savedRate = parseFloat(localStorage.getItem('cnyExchangeRate') || '');
    const exchangeRate = !isNaN(savedRate) && savedRate > 0 ? savedRate : 210;

    // 사이즈/색상/가격은 옵션마다 다를 수 있어 옵션별로 채운다. URL/SKU/재질/중량만 공통으로 채운다.
    const commonFields: Partial<Product> = {};
    if (payload.url) commonFields.url = String(payload.url);
    if (payload.sku) commonFields.sku = String(payload.sku);
    // 재질은 색상/사이즈처럼 상품에 내장된 고정 항목(product.material)이라, 상품등록 화면에
    // 항상 보이는 "소재" 칸에 바로 채워 넣는다(추가 항목으로 새로 생기는 게 아니라 기존 칸이 채워짐).
    if (payload.materialRaw) commonFields.material = String(payload.materialRaw).trim();
    if (typeof payload.weightG === 'number' && payload.weightG > 0) {
      commonFields.weight = String(payload.weightG);
    }

    expandProductGroup(productId);

    // 옵션이 여러 개면 현재 행 바로 뒤에 (옵션 개수 - 1)개를 복제해서 옵션 개수만큼 상품행을 만든다.
    const targetIds = [productId, ...variants.slice(1).map(() => generateId())];
    if (variants.length > 1) {
      setProducts(prev => {
        const idx = prev.findIndex(p => p.id === productId);
        if (idx === -1) return prev;
        const clones = targetIds.slice(1).map(id => ({ ...prev[idx], id }));
        const next = [...prev];
        next.splice(idx + 1, 0, ...clones);
        return next;
      });
    }

    setProducts(prev => prev.map(p => {
      const variantIndex = targetIds.indexOf(p.id);
      if (variantIndex === -1) return p;
      const variant = variants[variantIndex];
      const perVariantFields: Partial<Product> = {};
      if (typeof variant.priceCny === 'number' && variant.priceCny > 0) {
        perVariantFields.costPrice = String(Math.round(variant.priceCny * exchangeRate));
      }
      if (typeof variant.costPriceKrw === 'number' && variant.costPriceKrw > 0) {
        perVariantFields.costPrice = String(Math.round(variant.costPriceKrw));
      }
      if (typeof variant.supplyPriceKrw === 'number' && variant.supplyPriceKrw > 0) {
        perVariantFields.supplyPrice = String(Math.round(variant.supplyPriceKrw));
      }
      if (typeof variant.sellingPriceKrw === 'number' && variant.sellingPriceKrw > 0) {
        perVariantFields.sellingPrice = String(Math.round(variant.sellingPriceKrw));
      }
      if (typeof variant.marginKrw === 'number') {
        perVariantFields.margin = String(Math.round(variant.marginKrw));
      }
      if (variant.sizeCm) {
        if (typeof variant.sizeCm.width === 'number') perVariantFields.sizeWidth = String(variant.sizeCm.width);
        if (typeof variant.sizeCm.height === 'number') perVariantFields.sizeHeight = String(variant.sizeCm.height);
        if (typeof variant.sizeCm.depth === 'number') perVariantFields.sizeDepth = String(variant.sizeCm.depth);
      }
      // 옵션이 여러 개면(위에서 복제한 경우) 원본 행의 파일명을 그대로 물려받아 전부 같은 번호가
      // 되어 있으므로, 옵션 순서(1번=001, 2번=002...)에 맞춰 새로 매긴다. 옵션이 1개뿐이면 원래
      // 있던 파일명을 그대로 둔다.
      const fileNames = variants.length > 1 ? numberedFileNames(variantIndex + 1) : {};
      return { ...p, ...commonFields, ...perVariantFields, ...fileNames };
    }));

    // "노출속성"(옵션값)을 어느 항목에 채울지는 이 상품에 연결된 견적서 카테고리 설정을 따른다.
    // 색상이면 내장 color 필드에, 그 외에는 등록된 추가 항목(customFields)에 채운다.
    const registration = quoteTemplateRegistrations.find(r => r.id === product.quoteTemplateId);
    const optionFieldName = registration?.optionFieldName || OPTION_FIELD_COLOR;

    // 상품명/옵션명(색상)은 확장프로그램에서 이미 직접 입력해서 넘어오는 값이라 AI 여부와 무관하게
    // 항상 원문 그대로 채운다(제조사 번역이 실패해도 이 값들은 반영되어야 하므로 AI 호출과 분리).
    setProducts(prev => prev.map(p => {
      const variantIndex = targetIds.indexOf(p.id);
      if (variantIndex === -1) return p;
      const variant = variants[variantIndex];
      const optionValue = variant.colorRaw || '';
      const next: Product = {
        ...p,
        ...(payload.titleRaw ? { productName: String(payload.titleRaw) } : {}),
        ...(!use1688AiTranslation && payload.manufacturerRaw ? { manufacturer: String(payload.manufacturerRaw) } : {}),
      };
      if (optionFieldName === OPTION_FIELD_COLOR) {
        next.color = optionValue;
      } else if (optionValue) {
        next.customFields = { ...p.customFields, [optionFieldName]: optionValue };
      }
      return next;
    }));

    // AI 번역을 꺼둔 경우, 여기서 끝(제조사는 위에서 이미 원문 그대로 채웠고 검색어는 비워둔다).
    if (!use1688AiTranslation) return;

    setImporting1688ProductIds(prev => new Set([...prev, ...targetIds]));
    try {
      // 제조사/검색어는 옵션과 무관한 공통 값이라 딱 1번만 호출해서 모든 행에 동일하게 적용한다
      // (옵션마다 따로 호출하면 AI 응답이 매번 조금씩 달라져 행마다 값이 어긋난다).
      const aiFields = await generateProductImportFields(
        payload.titleRaw || '',
        payload.manufacturerRaw || '',
        variants.map(v => v.colorRaw || ''),
        product.category
      );
      setProducts(prev => prev.map(p => {
        const variantIndex = targetIds.indexOf(p.id);
        if (variantIndex === -1) return p;
        return {
          ...p,
          ...(aiFields.manufacturerEn ? { manufacturer: withCoLtdSuffix(aiFields.manufacturerEn) } : {}),
          ...(aiFields.keywords ? { searchKeyword: aiFields.keywords } : {}),
        };
      }));
    } catch (error) {
      console.error('Failed to generate product import fields:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      alert(`제조사 번역/검색어 생성에 실패했습니다: ${errorMessage}\n(URL/원가/사이즈/중량/상품명/옵션명은 이미 반영되었습니다)`);
    } finally {
      setImporting1688ProductIds(prev => {
        const next = new Set(prev);
        targetIds.forEach(id => next.delete(id));
        return next;
      });
    }
  }, [products, quoteTemplateRegistrations, use1688AiTranslation, expandProductGroup]);

  // 확장프로그램의 수익 계산기 팝업이 클립보드에 복사해둔 JSON을 읽어와 해당 상품행의
  // 원가/공급가/판매가/마진 필드에 그대로 채워 넣습니다(앱 내 계산기의 "저장하고 적용하기"와 동일).
  const handleImportMarginFromClipboard = useCallback(async (productId: string) => {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      alert('이 브라우저 탭에서는 클립보드 읽기를 사용할 수 없습니다.\n주소창의 URL이 http://localhost:3000 또는 https://로 시작하는지 확인해주세요. (192.168.x.x 같은 일반 HTTP 주소에서는 보안 정책상 클립보드 API가 동작하지 않습니다.)');
      return;
    }

    let payload: any;
    try {
      const clipboardText = await navigator.clipboard.readText();
      payload = JSON.parse(clipboardText);
    } catch (error) {
      alert('클립보드에서 수익 계산기 데이터를 찾지 못했습니다. 확장프로그램 팝업에서 복사하기를 먼저 눌러주세요.');
      return;
    }

    if (!payload || payload.source !== 'margin-calc') {
      alert('클립보드 내용이 수익 계산기 데이터 형식이 아닙니다. 확장프로그램 팝업에서 복사하기를 먼저 눌러주세요.');
      return;
    }

    setProducts(prev => prev.map(p => p.id === productId ? {
      ...p,
      costPrice: String(payload.costPrice ?? p.costPrice),
      supplyPrice: String(payload.supplyPrice ?? p.supplyPrice),
      sellingPrice: String(payload.sellingPrice ?? p.sellingPrice),
      margin: String(payload.margin ?? p.margin),
    } : p));
  }, []);

  const openMemoModal = useCallback((product: Product) => {
    setMemoModalState({ isOpen: true, product });
  }, []);

  const closeMemoModal = useCallback(() => {
    setMemoModalState({ isOpen: false, product: null });
  }, []);

  const handleSaveMemo = useCallback((memo: string) => {
    if (!memoModalState.product) return;
    handleProductChange(memoModalState.product.id, 'memo', memo);
  }, [memoModalState.product, handleProductChange]);

  // Translation Handlers
  const handleOpenTranslation = useCallback((productId: string, imageDataUrl: string | undefined, field: 'thumbnailDataUrl' | 'detailDataUrl') => {
    setTranslationState({
      isOpen: true,
      imageDataUrl,
      productId,
      field
    });
  }, []);

  const handleCloseTranslation = useCallback(() => {
    setTranslationState(prev => ({ ...prev, isOpen: false, imageDataUrl: undefined, productId: null, field: null }));
  }, []);

  const handleSaveTranslationImage = useCallback((newDataUrl: string) => {
    if (translationState.productId && translationState.field) {
        handleProductChange(translationState.productId, translationState.field as keyof Product, newDataUrl);
        alert('번역된 이미지로 교체되었습니다.');
    }
    handleCloseTranslation();
  }, [translationState, handleProductChange, handleCloseTranslation]);

  // Image Editor Handlers
  const openImageEditor = useCallback((product: Product) => {
    setImageEditorState({ isOpen: true, product });
  }, []);

  const closeImageEditor = useCallback(() => {
    setImageEditorState({ isOpen: false, product: null });
  }, []);

  const handleSaveFromImageEditor = useCallback((field: 'thumbnailDataUrl' | 'detailDataUrl', dataUrl: string) => {
    if (imageEditorState.product) {
      handleProductChange(imageEditorState.product.id, field, dataUrl);
      alert('편집한 이미지로 교체되었습니다.');
    }
    closeImageEditor();
  }, [imageEditorState.product, handleProductChange, closeImageEditor]);

  // Detail Page Builder Handlers
  const openDetailPageBuilder = useCallback((product: Product) => {
    setDetailPageBuilderState({ isOpen: true, product });
  }, []);

  const closeDetailPageBuilder = useCallback(() => {
    setDetailPageBuilderState({ isOpen: false, product: null });
  }, []);

  // 같은 URL을 공유하는 옵션들(=하나의 상품 그룹)을 하나의 상세페이지로 함께 관리하기 위해, 빌더를
  // 연 상품이 속한 그룹의 모든 상품을 반환한다. 상세페이지 이미지는 이 그룹 전체에 동일하게
  // 저장하고, 대표이미지만 옵션별로 다르게 지정할 수 있게 한다.
  const getGroupProducts = useCallback((product: Product) => {
    const key = getProductGroupKey(product);
    return products.filter(p => getProductGroupKey(p) === key);
  }, [products]);

  const handleSaveFromDetailPageBuilder = useCallback((field: 'thumbnailDataUrl' | 'detailDataUrl' | 'detailFile', value: string) => {
    if (detailPageBuilderState.product) {
      if (field === 'detailDataUrl' || field === 'detailFile') {
        // 상세페이지(이미지/파일명)는 이 상품 하나가 아니라 같은 그룹의 옵션 전체에 동일하게 적용한다.
        const groupIds = new Set(getGroupProducts(detailPageBuilderState.product).map(p => p.id));
        setProducts(prev => prev.map(p => (groupIds.has(p.id) ? { ...p, [field]: value } : p)));
      } else {
        handleProductChange(detailPageBuilderState.product.id, field, value);
      }
      // detailFile은 용량 때문에 JPEG로 대체될 때 detailDataUrl 저장 직전에 확장자만 맞추려고
      // 함께 오는 부수 업데이트라 여기서 완료 알림/모달 닫기를 트리거하지 않는다.
      if (field === 'detailDataUrl') {
        alert('상세페이지 이미지로 저장되었습니다.');
        const productId = detailPageBuilderState.product.id;
        setDetailPageDoneId(productId);
        setTimeout(() => setDetailPageDoneId(prev => (prev === productId ? null : prev)), 1500);
      }
    }
    if (field !== 'detailFile') closeDetailPageBuilder();
  }, [detailPageBuilderState.product, handleProductChange, closeDetailPageBuilder, getGroupProducts]);

  // 사진 갤러리에서 특정 사진을 특정 옵션의 대표이미지로 지정한다(옵션마다 다른 사진을 쓸 수 있게).
  // 대표이미지 지정은 상세페이지를 계속 작업 중인 상태에서의 부수 동작이라 모달을 닫지 않는다.
  const handleSaveThumbnailFromDetailPageBuilder = useCallback((productId: string, dataUrl: string) => {
    handleProductChange(productId, 'thumbnailDataUrl', dataUrl);
  }, [handleProductChange]);

  const filteredProducts = products.filter(product => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase().trim();
    const valuesToSearch = [
        product.url,
        product.memo,
        product.category,
        product.productName,
        product.sku,
        product.costPrice,
        product.supplyPrice,
        product.sellingPrice,
        product.margin,
        product.color,
        product.quantity,
        product.searchKeyword,
        `${product.sizeWidth}*${product.sizeHeight}*${product.sizeDepth}`,
        product.weight,
        product.manufacturer,
        product.countryOfOrigin,
        product.importer,
        product.recommendedAge,
        product.asContact,
        product.thumbnailFile,
        product.detailFile,
        product.labelFile,
    ];
    return valuesToSearch.some(value => (value || '').toLowerCase().includes(query));
  });

  // 게시판처럼 상품 하나(=같은 URL을 공유하는 옵션들)를 한 줄로 묶는다. 순서는 원래 목록에서
  // 그 그룹이 처음 등장하는 위치를 따른다.
  const productGroups = useMemo(() => {
    const groups: { key: string; products: Product[] }[] = [];
    const groupIndexByKey = new Map<string, number>();
    filteredProducts.forEach(product => {
      const key = getProductGroupKey(product);
      const existingIndex = groupIndexByKey.get(key);
      if (existingIndex !== undefined) {
        groups[existingIndex].products.push(product);
      } else {
        groupIndexByKey.set(key, groups.length);
        groups.push({ key, products: [product] });
      }
    });
    return groups;
  }, [filteredProducts]);

  // 검색 중일 때는 어느 그룹이 접혀있든 상관없이 검색 결과가 바로 보여야 하므로 전부 펼친다.
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="min-h-screen text-slate-200 flex flex-col items-start p-4 sm:p-6 lg:p-8">
      <div className="w-full flex flex-row items-start gap-6">
      <div className="flex-1 min-w-0 relative z-10">
      {currentView === 'renamer' ? (
        <ImageRenamer onBack={() => setCurrentView('products')} />
      ) : currentView === 'productList' ? (
        <ProductListPage
          entries={archivedProducts}
          onBack={() => setCurrentView('products')}
          onDelete={handleDeleteArchivedProduct}
          onClearAll={handleClearArchivedProducts}
        />
      ) : (
        <div className="w-full max-w-screen-2xl text-gray-900">
          <header className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-3">
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                    onClick={handleOpenExtensionsPage}
                    className="inline-flex items-center justify-center p-1.5 bg-white border border-gray-300 text-gray-500 rounded-md hover:bg-gray-50 hover:text-gray-700 transition-colors flex-shrink-0 [&_svg]:h-4 [&_svg]:w-4"
                    title={extensionsLinkCopied ? 'chrome://extensions/ 복사됨! 새 탭에 붙여넣으세요' : 'chrome://extensions/ 주소 복사 (보안 정책상 브라우저가 바로 이동을 막아서, 주소를 복사한 뒤 새 탭에 직접 붙여넣어야 합니다)'}
                >
                    {extensionsLinkCopied ? <CheckIcon className="text-emerald-600" /> : <SettingsIcon />}
                </button>
                <button
                    onClick={handleAddProduct}
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
                >
                    <PlusIcon />
                    <span className="hidden sm:inline">상품 추가</span>
                </button>
                <div className="relative flex-1 sm:max-w-xs">
                    <span className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
                        <SearchIcon />
                    </span>
                    <input
                        type="text"
                        placeholder="검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-3 py-1.5 bg-white border border-gray-300 text-gray-900 text-sm placeholder:text-gray-400 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                    />
                </div>
            </div>
            <div className="flex items-center gap-1 flex-wrap justify-end [&_svg]:h-4 [&_svg]:w-4 [&_svg]:mr-0">
                <button
                    onClick={handleSaveProducts}
                    disabled={saveStatus !== 'idle'}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <SaveIcon />
                    <span>{saveStatus === 'saving' ? '저장 중...' : saveStatus === 'saved' ? '저장됨!' : '저장'}</span>
                </button>
                <button
                    onClick={() => setCurrentView('productList')}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
                    title="URL/상품명/가격/바코드만 저장된 상품목록 보기"
                >
                    <ArchiveIcon />
                    <span className="hidden sm:inline">상품목록{archivedProducts.length > 0 ? ` (${archivedProducts.length})` : ''}</span>
                </button>
                <button
                    onClick={handleRemoveAllProducts}
                    className={`inline-flex items-center justify-center gap-1 px-2.5 py-1.5 text-sm font-medium rounded-md focus:outline-none focus:ring-2 transition-colors ${
                        confirmResetAll
                        ? 'bg-red-600 text-white hover:bg-red-500 focus:ring-red-400'
                        : 'bg-white border border-gray-300 text-red-600 hover:bg-red-50 focus:ring-red-400'
                    }`}
                    aria-label="Reset all products"
                  >
                    <BroomIcon />
                    <span className="hidden sm:inline">{confirmResetAll ? '확인' : '초기화'}</span>
                </button>
                <button
                    onClick={() => setCurrentView('renamer')}
                    className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
                    title="옵션명 생성"
                >
                    <CameraIcon />
                    <span className="hidden sm:inline">옵션명</span>
                </button>
               <input
                type="file"
                id="bulk-thumbnail-upload"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleBulkThumbnailUpload}
              />
              <label
                htmlFor="bulk-thumbnail-upload"
                className="cursor-pointer inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
                title="대표이미지 일괄 업로드"
              >
                <DocumentAddIcon />
                <span className="hidden sm:inline">대표 일괄</span>
              </label>
              <input
                type="file"
                id="bulk-detail-upload"
                multiple
                accept="image/*"
                className="hidden"
                onChange={handleBulkDetailImageUpload}
              />
              <label
                htmlFor="bulk-detail-upload"
                className="cursor-pointer inline-flex items-center justify-center gap-1 px-2.5 py-1.5 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-colors"
                title="상세이미지 일괄 업로드"
              >
                <DocumentAddIcon />
                <span className="hidden sm:inline">상세 일괄</span>
              </label>
            </div>
          </header>

          <div className="space-y-3">
            {productGroups.map((group, groupIdx) => {
              const groupProductIds = group.products.map(p => p.id);
              const isExpanded = isSearching || groupProductIds.some(id => expandedProductIds.has(id));
              return (
                <div key={group.key}>
                  <ProductGroupSummary
                    groupIndex={groupIdx + 1}
                    products={group.products}
                    isExpanded={isExpanded}
                    onToggle={() => toggleGroupExpanded(groupProductIds)}
                    onProductChange={handleProductChange}
                    registeredCategories={categories}
                    quoteTemplateRegistrations={quoteTemplateRegistrations}
                    onImportFrom1688={handleImportFrom1688}
                    isImportingFrom1688={importing1688ProductIds.has(group.products[0].id)}
                    onOpenDetailPageBuilder={openDetailPageBuilder}
                    isDetailPageDone={detailPageDoneId === group.products[0].id}
                    onIntegratedDownload={handleIntegratedDownload}
                    isIntegratedDownloading={integratedDownloadingId === group.products[0].id}
                    isIntegratedDownloadDone={integratedDownloadDoneId === group.products[0].id}
                    onArchiveGroup={handleArchiveProductGroup}
                  />
                  {isExpanded && (
                    <div className="mt-3 ml-3 pl-4 border-l-2 border-gray-200 space-y-4">
                      {group.products.map((product, optionIndex) => (
                        <div
                          key={product.id}
                          className={`overflow-visible transition-all duration-200 ${activeProductId === product.id ? 'z-[100] relative' : 'z-0 relative'}`}
                        >
                          <ProductRow
                            product={product}
                            displayIndex={optionIndex}
                            onProductChange={handleProductChange}
                            onRemoveProduct={handleRemoveProduct}
                            onDuplicateProduct={handleDuplicateProduct}
                            onGenerateLabel={openLabelModal}
                            onGenerateBarcodeLabel={openBarcodeLabelModal}
                            onOpenMemoModal={openMemoModal}
                            onOpenMarginCalculator={openMarginCalculator}
                            onCopyFromAbove={handleCopyFromAbove}
                            onOpenTranslation={(dataUrl, field) => handleOpenTranslation(product.id, dataUrl, field)}
                            onOpenImageEditor={openImageEditor}
                            onMenuToggle={(isOpen) => setActiveProductId(isOpen ? product.id : null)}
                            onSetCustomField={handleSetProductCustomField}
                            onRemoveCustomField={handleRemoveProductCustomField}
                            onTogglePackageSizeSameAsProduct={handleTogglePackageSizeSameAsProduct}
                            onGenerateProductQuote={handleGenerateProductQuote}
                            isGeneratingQuote={generatingProductQuoteId === product.id}
                            onImportProductQuote={handleImportProductQuote}
                            isImportingQuote={importingProductQuoteId === product.id}
                            use1688AiTranslation={use1688AiTranslation}
                            onToggle1688AiTranslation={handleToggle1688AiTranslation}
                            onImportMarginFromClipboard={handleImportMarginFromClipboard}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-8 flex flex-wrap justify-center items-center gap-4">
              <button
                onClick={handleGenerateSampleExcel}
                disabled={isSampleExporting}
                className="flex items-center justify-center px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 transition-all duration-200 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <DownloadIcon />
                <span>{isSampleExporting ? '생성 중...' : '샘플'}</span>
              </button>
              <button
                onClick={handleGenerateProposalExcel}
                disabled={isExporting}
                className="flex items-center justify-center px-4 py-2 bg-emerald-500 text-white font-semibold rounded-lg shadow-md hover:bg-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-opacity-75 transition-all duration-200 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                <DownloadIcon />
                <span className="w-28 text-center">{isExporting ? '생성 중...' : '제안상품목록'}</span>
              </button>
               <button
                onClick={() => setIsQuoteModalOpen(true)}
                className="flex items-center justify-center px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 transition-all duration-200"
              >
                <DocumentAddIcon />
                견적서 생성
              </button>
              <button
                onClick={() => setIsQuoteTemplateManagerOpen(true)}
                className="flex items-center justify-center px-4 py-2 bg-blue-700 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 transition-all duration-200"
              >
                <TagIcon />
                <span className="ml-2">견적서 등록</span>
              </button>
              <button
                onClick={() => setIsQuoteSettingsModalOpen(true)}
                title="견적서 고정값 설정"
                aria-label="견적서 고정값 설정"
                className="flex items-center justify-center p-2.5 bg-white border border-gray-300 text-gray-600 rounded-lg shadow-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-opacity-75 transition-all duration-200"
              >
                <SettingsIcon />
              </button>
          </div>
        </div>
      )}
      </div>

      <NotepadSidebar />
      </div>

      {/* Off-screen: 통합다운이 라벨 모달을 열지 않고 라벨 이미지를 캡처하기 위한 숨김 렌더링 */}
      <div style={{ position: 'fixed', top: 0, left: '-9999px', pointerEvents: 'none' }} aria-hidden="true">
        {labelCaptureProduct && <ProductLabel ref={hiddenLabelCaptureRef} product={labelCaptureProduct} />}
      </div>

      {isLabelModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[1000] p-4 transition-opacity duration-300" onClick={closeLabelModal}>
          <div className="bg-slate-800 rounded-xl shadow-2xl max-w-3xl w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95" onClick={e => e.stopPropagation()}>
            <button onClick={closeLabelModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
              <CloseIcon />
            </button>
            <h2 className="text-2xl font-bold text-slate-100 mb-6">생성된 라벨 이미지</h2>
            
            <div className="absolute -left-[9999px] top-0 opacity-0" aria-hidden="true">
                <ProductLabel ref={labelRef} product={currentProductForLabel} />
            </div>

            <div className="bg-slate-700 rounded-lg p-4 min-h-[400px] flex flex-col justify-center items-center border border-slate-600">
                {isGenerating && (
                    <div className="flex flex-col items-center gap-4 text-slate-400">
                        <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>이미지 생성 중...</span>
                    </div>
                )}
                {!isGenerating && generatedLabelImage && (
                    <img src={generatedLabelImage} alt="Generated Product Label" className="max-w-full h-auto object-contain rounded-md shadow-md" />
                )}
                {!isGenerating && !generatedLabelImage && (
                    <p className="text-slate-400">이미지를 생성할 수 없습니다.</p>
                )}
            </div>

            {!isGenerating && generatedLabelImage && (
                <div className="mt-6 flex flex-col sm:flex-row justify-end gap-3">
                    <button onClick={closeLabelModal} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
                        닫기
                    </button>
                    <button onClick={downloadImage} className="flex items-center justify-center px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-200">
                        <DownloadIcon />
                        다운로드
                    </button>
                </div>
            )}
          </div>
        </div>
      )}

      {isBarcodeLabelModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-[1000] p-4 transition-opacity duration-300" onClick={closeBarcodeLabelModal}>
          <div className="bg-slate-800 rounded-xl shadow-2xl max-w-3xl w-full p-6 sm:p-8 relative transform transition-all duration-300 scale-95" onClick={e => e.stopPropagation()}>
            <button onClick={closeBarcodeLabelModal} className="absolute top-4 right-4 text-slate-400 hover:text-slate-200 transition-colors" aria-label="Close modal">
              <CloseIcon />
            </button>
            <h2 className="text-2xl font-bold text-slate-100 mb-6">생성된 바코드 라벨 이미지</h2>

            <div className="absolute -left-[9999px] top-0 opacity-0" aria-hidden="true">
                <BarcodeLabel ref={barcodeLabelRef} product={currentProductForBarcodeLabel} />
            </div>

            <div className="bg-slate-700 rounded-lg p-4 min-h-[400px] flex flex-col justify-center items-center border border-slate-600">
                {isGeneratingBarcodeLabel && (
                    <div className="flex flex-col items-center gap-4 text-slate-400">
                        <svg className="animate-spin h-8 w-8 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>이미지 생성 중...</span>
                    </div>
                )}
                {!isGeneratingBarcodeLabel && generatedBarcodeLabelImage && (
                    <img src={generatedBarcodeLabelImage} alt="Generated Barcode Label" className="max-w-full h-auto object-contain rounded-md shadow-md" />
                )}
                {!isGeneratingBarcodeLabel && !generatedBarcodeLabelImage && (
                    <p className="text-slate-400">이미지를 생성할 수 없습니다.</p>
                )}
            </div>

            {!isGeneratingBarcodeLabel && generatedBarcodeLabelImage && (
                <div className="mt-6 flex flex-col sm:flex-row justify-end gap-3">
                    <button onClick={closeBarcodeLabelModal} className="px-4 py-2 bg-slate-600 text-slate-200 font-semibold rounded-lg hover:bg-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 transition-all duration-200">
                        닫기
                    </button>
                    <button onClick={downloadBarcodeLabelImage} className="flex items-center justify-center px-4 py-2 bg-blue-500 text-white font-semibold rounded-lg shadow-md hover:bg-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-400 transition-all duration-200">
                        <DownloadIcon />
                        다운로드
                    </button>
                </div>
            )}
          </div>
        </div>
      )}

      {marginCalculatorState.isOpen && (
        <MarginCalculatorModal
            isOpen={marginCalculatorState.isOpen}
            onClose={closeMarginCalculator}
            onSave={handleSaveMarginCalculator}
        />
      )}

      {isQuoteModalOpen && (
        <QuoteGeneratorModal
          isOpen={isQuoteModalOpen}
          onClose={() => setIsQuoteModalOpen(false)}
          products={products}
          onProductsUpdate={setProducts}
          fixedValues={quoteFixedValues}
        />
      )}

      <MissingFieldsModal
        isOpen={!!missingFieldsProductId}
        items={(() => {
          const product = products.find(p => p.id === missingFieldsProductId);
          if (!product) return [];
          const groupKey = getProductGroupKey(product);
          const groupProducts = products.filter(p => getProductGroupKey(p) === groupKey);
          return collectMissingFields(groupProducts);
        })()}
        onCancel={() => setMissingFieldsProductId(null)}
        onProceedAnyway={() => {
          const productId = missingFieldsProductId;
          setMissingFieldsProductId(null);
          if (productId) runGenerateProductQuote(productId);
        }}
      />

      <MissingFieldsModal
        isOpen={!!requiredFieldGaps}
        items={requiredFieldGaps ?? []}
        onCancel={() => setRequiredFieldGaps(null)}
        title="필수 항목이 비어 있습니다"
        description="선택한 발주서 양식의 6행에 '필수'로 표시된 항목이 비어 있어 생성할 수 없습니다. 상품등록에서 값을 채운 뒤 다시 시도해주세요."
      />

      {isQuoteSettingsModalOpen && (
        <QuoteSettingsModal
          isOpen={isQuoteSettingsModalOpen}
          onClose={() => setIsQuoteSettingsModalOpen(false)}
          values={quoteFixedValues}
          onSave={handleSaveQuoteFixedValues}
        />
      )}

      {isQuoteTemplateManagerOpen && (
        <QuoteTemplateManagerModal
          isOpen={isQuoteTemplateManagerOpen}
          onClose={() => setIsQuoteTemplateManagerOpen(false)}
          registrations={quoteTemplateRegistrations}
          onAdd={handleAddQuoteTemplateRegistration}
          onDelete={handleDeleteQuoteTemplateRegistration}
          onCleanupDuplicates={handleCleanupDuplicateQuoteTemplates}
          onUpdateCustomFieldNames={handleUpdateQuoteTemplateCustomFieldNames}
          onUpdateOptionFieldName={handleUpdateQuoteTemplateOptionFieldName}
          onSetExposureBaseTemplate={handleSetExposureBaseTemplate}
          categories={categories}
          onDeleteCategory={handleDeleteCategory}
        />
      )}

      {memoModalState.isOpen && memoModalState.product && (
        <MemoModal
            isOpen={memoModalState.isOpen}
            onClose={closeMemoModal}
            onSave={handleSaveMemo}
            initialMemo={memoModalState.product.memo}
        />
      )}

      {translationState.isOpen && (
        <TranslationModal 
          isOpen={translationState.isOpen}
          onClose={handleCloseTranslation}
          imageDataUrl={translationState.imageDataUrl}
          onSaveImage={handleSaveTranslationImage}
        />
      )}

      {imageEditorState.isOpen && (
        <ImageEditorModal
          isOpen={imageEditorState.isOpen}
          onClose={closeImageEditor}
          product={imageEditorState.product}
          onSave={handleSaveFromImageEditor}
        />
      )}

      <DetailPageBuilderModal
        isOpen={detailPageBuilderState.isOpen}
        onClose={closeDetailPageBuilder}
        product={detailPageBuilderState.product}
        groupProducts={detailPageBuilderState.product ? getGroupProducts(detailPageBuilderState.product) : []}
        onSave={handleSaveFromDetailPageBuilder}
        onSaveThumbnail={handleSaveThumbnailFromDetailPageBuilder}
      />
    </div>
  );
};

export default App;
