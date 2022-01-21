/**
 * Created by vadimdez on 21/06/16.
 */
import { ElementRef, EventEmitter, OnChanges, SimpleChanges, OnInit, OnDestroy, AfterViewChecked, NgZone } from '@angular/core';
import type { PDFSource, PDFProgressData } from './typings';
import * as i0 from "@angular/core";
export declare enum RenderTextMode {
    DISABLED = 0,
    ENABLED = 1,
    ENHANCED = 2
}
export declare class PdfViewerComponent implements OnChanges, OnInit, OnDestroy, AfterViewChecked {
    private element;
    private ngZone;
    static CSS_UNITS: number;
    static BORDER_WIDTH: number;
    pdfViewerContainer: any;
    private isVisible;
    private pdfMultiPageViewer;
    private pdfMultiPageLinkService;
    private pdfMultiPageFindController;
    private pdfSinglePageViewer;
    private pdfSinglePageLinkService;
    private pdfSinglePageFindController;
    private _cMapsUrl;
    private _renderText;
    private _renderTextMode;
    private _stickToPage;
    private _originalSize;
    private _pdf;
    private _page;
    private _zoom;
    private _zoomScale;
    private _rotation;
    private _showAll;
    private _canAutoResize;
    private _fitToPage;
    private _externalLinkTarget;
    private _showBorders;
    private lastLoaded;
    private _latestScrolledPage;
    private resizeTimeout;
    private pageScrollTimeout;
    private isInitialized;
    private loadingTask;
    private destroy$;
    afterLoadComplete: EventEmitter<import("pdfjs-dist/types/src/display/api").PDFDocumentProxy>;
    pageRendered: EventEmitter<CustomEvent<any>>;
    pageInitialized: EventEmitter<CustomEvent<any>>;
    textLayerRendered: EventEmitter<CustomEvent<any>>;
    onError: EventEmitter<any>;
    onProgress: EventEmitter<PDFProgressData>;
    pageChange: EventEmitter<number>;
    src: string | Uint8Array | PDFSource;
    set cMapsUrl(cMapsUrl: string);
    set page(_page: any);
    set renderText(renderText: boolean);
    set renderTextMode(renderTextMode: RenderTextMode);
    set originalSize(originalSize: boolean);
    set showAll(value: boolean);
    set stickToPage(value: boolean);
    set zoom(value: number);
    get zoom(): number;
    set zoomScale(value: 'page-height' | 'page-fit' | 'page-width');
    get zoomScale(): 'page-height' | 'page-fit' | 'page-width';
    set rotation(value: number);
    set externalLinkTarget(value: string);
    set autoresize(value: boolean);
    set fitToPage(value: boolean);
    set showBorders(value: boolean);
    static getLinkTarget(type: string): any;
    constructor(element: ElementRef<HTMLElement>, ngZone: NgZone);
    ngAfterViewChecked(): void;
    ngOnInit(): void;
    ngOnDestroy(): void;
    get pdfLinkService(): any;
    get pdfViewer(): any;
    get pdfFindController(): any;
    ngOnChanges(changes: SimpleChanges): void;
    updateSize(): void;
    clear(): void;
    private getPDFLinkServiceConfig;
    private setupMultiPageViewer;
    private setupSinglePageViewer;
    private getValidPageNumber;
    private getDocumentParams;
    private loadPDF;
    private update;
    private render;
    private getScale;
    private getCurrentViewer;
    private resetPdfDocument;
    private initialize;
    private setupResizeListener;
    static ɵfac: i0.ɵɵFactoryDeclaration<PdfViewerComponent, never>;
    static ɵcmp: i0.ɵɵComponentDeclaration<PdfViewerComponent, "pdf-viewer", never, { "src": "src"; "cMapsUrl": "c-maps-url"; "page": "page"; "renderText": "render-text"; "renderTextMode": "render-text-mode"; "originalSize": "original-size"; "showAll": "show-all"; "stickToPage": "stick-to-page"; "zoom": "zoom"; "zoomScale": "zoom-scale"; "rotation": "rotation"; "externalLinkTarget": "external-link-target"; "autoresize": "autoresize"; "fitToPage": "fit-to-page"; "showBorders": "show-borders"; }, { "afterLoadComplete": "after-load-complete"; "pageRendered": "page-rendered"; "pageInitialized": "pages-initialized"; "textLayerRendered": "text-layer-rendered"; "onError": "error"; "onProgress": "on-progress"; "pageChange": "pageChange"; }, never, never>;
}
