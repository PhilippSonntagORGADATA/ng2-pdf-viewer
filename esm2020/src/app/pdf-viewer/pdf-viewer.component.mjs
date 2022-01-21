/**
 * Created by vadimdez on 21/06/16.
 */
import { Component, Input, Output, EventEmitter, ViewChild } from '@angular/core';
import { from, fromEvent, Subject } from 'rxjs';
import { debounceTime, filter, takeUntil } from 'rxjs/operators';
import * as PDFJS from 'pdfjs-dist/legacy/build/pdf';
import * as PDFJSViewer from 'pdfjs-dist/legacy/web/pdf_viewer';
import { createEventBus } from '../utils/event-bus-utils';
import { assign, isSSR } from '../utils/helpers';
import * as i0 from "@angular/core";
if (!isSSR()) {
    assign(PDFJS, 'verbosity', PDFJS.VerbosityLevel.INFOS);
}
export var RenderTextMode;
(function (RenderTextMode) {
    RenderTextMode[RenderTextMode["DISABLED"] = 0] = "DISABLED";
    RenderTextMode[RenderTextMode["ENABLED"] = 1] = "ENABLED";
    RenderTextMode[RenderTextMode["ENHANCED"] = 2] = "ENHANCED";
})(RenderTextMode || (RenderTextMode = {}));
export class PdfViewerComponent {
    constructor(element, ngZone) {
        this.element = element;
        this.ngZone = ngZone;
        this.isVisible = false;
        this._cMapsUrl = typeof PDFJS !== 'undefined'
            ? `https://unpkg.com/pdfjs-dist@${PDFJS.version}/cmaps/`
            : null;
        this._renderText = true;
        this._renderTextMode = RenderTextMode.ENABLED;
        this._stickToPage = false;
        this._originalSize = true;
        this._page = 1;
        this._zoom = 1;
        this._zoomScale = 'page-width';
        this._rotation = 0;
        this._showAll = true;
        this._canAutoResize = true;
        this._fitToPage = false;
        this._externalLinkTarget = 'blank';
        this._showBorders = false;
        this.resizeTimeout = null;
        this.pageScrollTimeout = null;
        this.isInitialized = false;
        this.destroy$ = new Subject();
        this.afterLoadComplete = new EventEmitter();
        this.pageRendered = new EventEmitter();
        this.pageInitialized = new EventEmitter();
        this.textLayerRendered = new EventEmitter();
        this.onError = new EventEmitter();
        this.onProgress = new EventEmitter();
        this.pageChange = new EventEmitter(true);
        if (isSSR()) {
            return;
        }
        let pdfWorkerSrc;
        if (window.hasOwnProperty('pdfWorkerSrc') &&
            typeof window.pdfWorkerSrc === 'string' &&
            window.pdfWorkerSrc) {
            pdfWorkerSrc = window.pdfWorkerSrc;
        }
        else {
            pdfWorkerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS.version}/legacy/build/pdf.worker.js`;
        }
        assign(PDFJS.GlobalWorkerOptions, 'workerSrc', pdfWorkerSrc);
    }
    set cMapsUrl(cMapsUrl) {
        this._cMapsUrl = cMapsUrl;
    }
    set page(_page) {
        _page = parseInt(_page, 10) || 1;
        const originalPage = _page;
        if (this._pdf) {
            _page = this.getValidPageNumber(_page);
        }
        this._page = _page;
        if (originalPage !== _page) {
            this.pageChange.emit(_page);
        }
    }
    set renderText(renderText) {
        this._renderText = renderText;
    }
    set renderTextMode(renderTextMode) {
        this._renderTextMode = renderTextMode;
    }
    set originalSize(originalSize) {
        this._originalSize = originalSize;
    }
    set showAll(value) {
        this._showAll = value;
    }
    set stickToPage(value) {
        this._stickToPage = value;
    }
    set zoom(value) {
        if (value <= 0) {
            return;
        }
        this._zoom = value;
    }
    get zoom() {
        return this._zoom;
    }
    set zoomScale(value) {
        this._zoomScale = value;
    }
    get zoomScale() {
        return this._zoomScale;
    }
    set rotation(value) {
        if (!(typeof value === 'number' && value % 90 === 0)) {
            console.warn('Invalid pages rotation angle.');
            return;
        }
        this._rotation = value;
    }
    set externalLinkTarget(value) {
        this._externalLinkTarget = value;
    }
    set autoresize(value) {
        this._canAutoResize = Boolean(value);
    }
    set fitToPage(value) {
        this._fitToPage = Boolean(value);
    }
    set showBorders(value) {
        this._showBorders = Boolean(value);
    }
    static getLinkTarget(type) {
        switch (type) {
            case 'blank':
                return PDFJS.LinkTarget.BLANK;
            case 'none':
                return PDFJS.LinkTarget.NONE;
            case 'self':
                return PDFJS.LinkTarget.SELF;
            case 'parent':
                return PDFJS.LinkTarget.PARENT;
            case 'top':
                return PDFJS.LinkTarget.TOP;
        }
        return null;
    }
    ngAfterViewChecked() {
        if (this.isInitialized) {
            return;
        }
        const offset = this.pdfViewerContainer.nativeElement.offsetParent;
        if (this.isVisible === true && offset == null) {
            this.isVisible = false;
            return;
        }
        if (this.isVisible === false && offset != null) {
            this.isVisible = true;
            setTimeout(() => {
                this.initialize();
                this.ngOnChanges({ src: this.src });
            });
        }
    }
    ngOnInit() {
        this.initialize();
        this.setupResizeListener();
    }
    ngOnDestroy() {
        this.clear();
        this.destroy$.next();
        this.loadingTask = null;
    }
    get pdfLinkService() {
        return this._showAll
            ? this.pdfMultiPageLinkService
            : this.pdfSinglePageLinkService;
    }
    get pdfViewer() {
        return this.getCurrentViewer();
    }
    get pdfFindController() {
        return this._showAll
            ? this.pdfMultiPageFindController
            : this.pdfSinglePageFindController;
    }
    ngOnChanges(changes) {
        if (isSSR() || !this.isVisible) {
            return;
        }
        if ('src' in changes) {
            this.loadPDF();
        }
        else if (this._pdf) {
            if ('renderText' in changes) {
                this.getCurrentViewer().textLayerMode = this._renderText
                    ? this._renderTextMode
                    : RenderTextMode.DISABLED;
                this.resetPdfDocument();
            }
            else if ('showAll' in changes) {
                this.resetPdfDocument();
            }
            if ('page' in changes) {
                const { page } = changes;
                if (page.currentValue === this._latestScrolledPage) {
                    return;
                }
                // New form of page changing: The viewer will now jump to the specified page when it is changed.
                // This behavior is introduced by using the PDFSinglePageViewer
                this.getCurrentViewer().scrollPageIntoView({ pageNumber: this._page });
            }
            this.update();
        }
    }
    updateSize() {
        const currentViewer = this.getCurrentViewer();
        from(this._pdf.getPage(currentViewer.currentPageNumber))
            .pipe(takeUntil(this.destroy$))
            .subscribe({
            next: (page) => {
                const rotation = this._rotation || page.rotate;
                const viewportWidth = page.getViewport({
                    scale: this._zoom,
                    rotation
                }).width * PdfViewerComponent.CSS_UNITS;
                let scale = this._zoom;
                let stickToPage = true;
                // Scale the document when it shouldn't be in original size or doesn't fit into the viewport
                if (!this._originalSize ||
                    (this._fitToPage &&
                        viewportWidth > this.pdfViewerContainer.nativeElement.clientWidth)) {
                    const viewPort = page.getViewport({ scale: 1, rotation });
                    scale = this.getScale(viewPort.width, viewPort.height);
                    stickToPage = !this._stickToPage;
                }
                currentViewer._setScale(scale, stickToPage);
            }
        });
    }
    clear() {
        if (this.loadingTask && !this.loadingTask.destroyed) {
            this.loadingTask.destroy();
        }
        if (this._pdf) {
            this._pdf.destroy();
            this._pdf = null;
            this.pdfMultiPageViewer.setDocument(null);
            this.pdfSinglePageViewer.setDocument(null);
            this.pdfMultiPageLinkService.setDocument(null, null);
            this.pdfSinglePageLinkService.setDocument(null, null);
            this.pdfMultiPageFindController.setDocument(null);
            this.pdfSinglePageFindController.setDocument(null);
        }
    }
    getPDFLinkServiceConfig() {
        const pdfLinkServiceConfig = {};
        const linkTarget = PdfViewerComponent.getLinkTarget(this._externalLinkTarget);
        if (linkTarget) {
            pdfLinkServiceConfig.externalLinkTarget = linkTarget;
        }
        return pdfLinkServiceConfig;
    }
    setupMultiPageViewer() {
        assign(PDFJS, 'disableTextLayer', !this._renderText);
        const eventBus = createEventBus(PDFJSViewer, this.destroy$);
        fromEvent(eventBus, 'pagerendered')
            .pipe(takeUntil(this.destroy$))
            .subscribe((event) => {
            this.pageRendered.emit(event);
        });
        fromEvent(eventBus, 'pagesinit')
            .pipe(takeUntil(this.destroy$))
            .subscribe((event) => {
            this.pageInitialized.emit(event);
        });
        fromEvent(eventBus, 'pagechanging')
            .pipe(takeUntil(this.destroy$))
            .subscribe(({ pageNumber }) => {
            if (this.pageScrollTimeout) {
                clearTimeout(this.pageScrollTimeout);
            }
            this.pageScrollTimeout = window.setTimeout(() => {
                this._latestScrolledPage = pageNumber;
                this.pageChange.emit(pageNumber);
            }, 100);
        });
        fromEvent(eventBus, 'textlayerrendered')
            .pipe(takeUntil(this.destroy$))
            .subscribe((event) => {
            this.textLayerRendered.emit(event);
        });
        this.pdfMultiPageLinkService = new PDFJSViewer.PDFLinkService({
            eventBus, ...this.getPDFLinkServiceConfig()
        });
        this.pdfMultiPageFindController = new PDFJSViewer.PDFFindController({
            linkService: this.pdfMultiPageLinkService,
            eventBus
        });
        const pdfOptions = {
            eventBus,
            container: this.element.nativeElement.querySelector('div'),
            removePageBorders: !this._showBorders,
            linkService: this.pdfMultiPageLinkService,
            textLayerMode: this._renderText
                ? this._renderTextMode
                : RenderTextMode.DISABLED,
            findController: this.pdfMultiPageFindController,
            renderer: 'canvas',
            l10n: undefined
        };
        this.pdfMultiPageViewer = new PDFJSViewer.PDFViewer(pdfOptions);
        this.pdfMultiPageLinkService.setViewer(this.pdfMultiPageViewer);
        this.pdfMultiPageFindController.setDocument(this._pdf);
    }
    setupSinglePageViewer() {
        assign(PDFJS, 'disableTextLayer', !this._renderText);
        const eventBus = createEventBus(PDFJSViewer, this.destroy$);
        fromEvent(eventBus, 'pagechanging')
            .pipe(takeUntil(this.destroy$))
            .subscribe(({ pageNumber }) => {
            if (pageNumber !== this._page) {
                this.page = pageNumber;
            }
        });
        fromEvent(eventBus, 'pagerendered')
            .pipe(takeUntil(this.destroy$))
            .subscribe((event) => {
            this.pageRendered.emit(event);
        });
        fromEvent(eventBus, 'pagesinit')
            .pipe(takeUntil(this.destroy$))
            .subscribe((event) => {
            this.pageInitialized.emit(event);
        });
        fromEvent(eventBus, 'textlayerrendered')
            .pipe(takeUntil(this.destroy$))
            .subscribe((event) => {
            this.textLayerRendered.emit(event);
        });
        this.pdfSinglePageLinkService = new PDFJSViewer.PDFLinkService({
            eventBus, ...this.getPDFLinkServiceConfig()
        });
        this.pdfSinglePageFindController = new PDFJSViewer.PDFFindController({
            linkService: this.pdfSinglePageLinkService,
            eventBus
        });
        const pdfOptions = {
            eventBus,
            container: this.element.nativeElement.querySelector('div'),
            removePageBorders: !this._showBorders,
            linkService: this.pdfSinglePageLinkService,
            textLayerMode: this._renderText
                ? this._renderTextMode
                : RenderTextMode.DISABLED,
            findController: this.pdfSinglePageFindController
        };
        this.pdfSinglePageViewer = new PDFJSViewer.PDFSinglePageViewer(pdfOptions);
        this.pdfSinglePageLinkService.setViewer(this.pdfSinglePageViewer);
        this.pdfSinglePageFindController.setDocument(this._pdf);
        this.pdfSinglePageViewer._currentPageNumber = this._page;
    }
    getValidPageNumber(page) {
        if (page < 1) {
            return 1;
        }
        if (page > this._pdf.numPages) {
            return this._pdf.numPages;
        }
        return page;
    }
    getDocumentParams() {
        const srcType = typeof this.src;
        if (!this._cMapsUrl) {
            return this.src;
        }
        const params = {
            cMapUrl: this._cMapsUrl,
            cMapPacked: true
        };
        if (srcType === 'string') {
            params.url = this.src;
        }
        else if (srcType === 'object') {
            if (this.src.byteLength !== undefined) {
                params.data = this.src;
            }
            else {
                Object.assign(params, this.src);
            }
        }
        return params;
    }
    loadPDF() {
        if (!this.src) {
            return;
        }
        if (this.lastLoaded === this.src) {
            this.update();
            return;
        }
        this.clear();
        this.loadingTask = PDFJS.getDocument(this.getDocumentParams());
        this.loadingTask.onProgress = (progressData) => {
            this.onProgress.emit(progressData);
        };
        const src = this.src;
        from(this.loadingTask.promise)
            .pipe(takeUntil(this.destroy$))
            .subscribe({
            next: (pdf) => {
                this._pdf = pdf;
                this.lastLoaded = src;
                this.afterLoadComplete.emit(pdf);
                if (!this.pdfMultiPageViewer) {
                    this.setupMultiPageViewer();
                    this.setupSinglePageViewer();
                }
                this.resetPdfDocument();
                this.update();
            },
            error: (error) => {
                this.onError.emit(error);
            }
        });
    }
    update() {
        this.page = this._page;
        this.render();
    }
    render() {
        this._page = this.getValidPageNumber(this._page);
        const currentViewer = this.getCurrentViewer();
        if (this._rotation !== 0 ||
            currentViewer.pagesRotation !== this._rotation) {
            setTimeout(() => {
                currentViewer.pagesRotation = this._rotation;
            });
        }
        if (this._stickToPage) {
            setTimeout(() => {
                currentViewer.currentPageNumber = this._page;
            });
        }
        this.updateSize();
    }
    getScale(viewportWidth, viewportHeight) {
        const borderSize = (this._showBorders ? 2 * PdfViewerComponent.BORDER_WIDTH : 0);
        const pdfContainerWidth = this.pdfViewerContainer.nativeElement.clientWidth - borderSize;
        const pdfContainerHeight = this.pdfViewerContainer.nativeElement.clientHeight - borderSize;
        if (pdfContainerHeight === 0 || viewportHeight === 0 || pdfContainerWidth === 0 || viewportWidth === 0) {
            return 1;
        }
        let ratio = 1;
        switch (this._zoomScale) {
            case 'page-fit':
                ratio = Math.min((pdfContainerHeight / viewportHeight), (pdfContainerWidth / viewportWidth));
                break;
            case 'page-height':
                ratio = (pdfContainerHeight / viewportHeight);
                break;
            case 'page-width':
            default:
                ratio = (pdfContainerWidth / viewportWidth);
                break;
        }
        return (this._zoom * ratio) / PdfViewerComponent.CSS_UNITS;
    }
    getCurrentViewer() {
        return this._showAll ? this.pdfMultiPageViewer : this.pdfSinglePageViewer;
    }
    resetPdfDocument() {
        this.pdfFindController.setDocument(this._pdf);
        if (this._showAll) {
            this.pdfSinglePageViewer.setDocument(null);
            this.pdfSinglePageLinkService.setDocument(null);
            this.pdfMultiPageViewer.setDocument(this._pdf);
            this.pdfMultiPageLinkService.setDocument(this._pdf, null);
        }
        else {
            this.pdfMultiPageViewer.setDocument(null);
            this.pdfMultiPageLinkService.setDocument(null);
            this.pdfSinglePageViewer.setDocument(this._pdf);
            this.pdfSinglePageLinkService.setDocument(this._pdf, null);
        }
    }
    initialize() {
        if (isSSR() || !this.isVisible) {
            return;
        }
        this.isInitialized = true;
        this.setupMultiPageViewer();
        this.setupSinglePageViewer();
    }
    setupResizeListener() {
        if (isSSR()) {
            return;
        }
        this.ngZone.runOutsideAngular(() => {
            fromEvent(window, 'resize')
                .pipe(debounceTime(100), filter(() => this._canAutoResize && !!this._pdf), takeUntil(this.destroy$))
                .subscribe(() => {
                this.updateSize();
            });
        });
    }
}
PdfViewerComponent.CSS_UNITS = 96.0 / 72.0;
PdfViewerComponent.BORDER_WIDTH = 9;
PdfViewerComponent.ɵfac = i0.ɵɵngDeclareFactory({ minVersion: "12.0.0", version: "13.1.3", ngImport: i0, type: PdfViewerComponent, deps: [{ token: i0.ElementRef }, { token: i0.NgZone }], target: i0.ɵɵFactoryTarget.Component });
PdfViewerComponent.ɵcmp = i0.ɵɵngDeclareComponent({ minVersion: "12.0.0", version: "13.1.3", type: PdfViewerComponent, selector: "pdf-viewer", inputs: { src: "src", cMapsUrl: ["c-maps-url", "cMapsUrl"], page: "page", renderText: ["render-text", "renderText"], renderTextMode: ["render-text-mode", "renderTextMode"], originalSize: ["original-size", "originalSize"], showAll: ["show-all", "showAll"], stickToPage: ["stick-to-page", "stickToPage"], zoom: "zoom", zoomScale: ["zoom-scale", "zoomScale"], rotation: "rotation", externalLinkTarget: ["external-link-target", "externalLinkTarget"], autoresize: "autoresize", fitToPage: ["fit-to-page", "fitToPage"], showBorders: ["show-borders", "showBorders"] }, outputs: { afterLoadComplete: "after-load-complete", pageRendered: "page-rendered", pageInitialized: "pages-initialized", textLayerRendered: "text-layer-rendered", onError: "error", onProgress: "on-progress", pageChange: "pageChange" }, viewQueries: [{ propertyName: "pdfViewerContainer", first: true, predicate: ["pdfViewerContainer"], descendants: true }], usesOnChanges: true, ngImport: i0, template: `
    <div #pdfViewerContainer class="ng2-pdf-viewer-container">
      <div class="pdfViewer"></div>
    </div>
  `, isInline: true, styles: [".ng2-pdf-viewer-container{overflow-x:auto;position:absolute;height:100%;width:100%;-webkit-overflow-scrolling:touch}:host{display:block;position:relative}:host ::ng-deep{--annotation-unfocused-field-background: url(\"data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>\");--xfa-unfocused-field-background: url(\"data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>\");--pdfViewer-padding-bottom: none;--page-margin: 1px auto -8px;--page-border: 9px solid transparent;--spreadHorizontalWrapped-margin-LR: -3.5px;--zoom-factor: 1}@media screen and (forced-colors: active){:host ::ng-deep{--pdfViewer-padding-bottom: 9px;--page-margin: 9px auto 0;--page-border: none;--spreadHorizontalWrapped-margin-LR: 4.5px}}:host ::ng-deep .textLayer{position:absolute;text-align:left;text-align:initial;left:0;top:0;right:0;bottom:0;overflow:hidden;opacity:.2;line-height:1}:host ::ng-deep .textLayer span,:host ::ng-deep .textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}:host ::ng-deep .textLayer .highlight{margin:-1px;padding:1px;background-color:#b400aa;border-radius:4px}:host ::ng-deep .textLayer .highlight.appended{position:static;position:initial}:host ::ng-deep .textLayer .highlight.begin{border-radius:4px 0 0 4px}:host ::ng-deep .textLayer .highlight.end{border-radius:0 4px 4px 0}:host ::ng-deep .textLayer .highlight.middle{border-radius:0}:host ::ng-deep .textLayer .highlight.selected{background-color:#006400}:host ::ng-deep .textLayer ::-moz-selection{background:blue}:host ::ng-deep .textLayer ::selection{background:blue}:host ::ng-deep .textLayer br::-moz-selection{background:transparent}:host ::ng-deep .textLayer br::selection{background:transparent}:host ::ng-deep .textLayer .endOfContent{display:block;position:absolute;left:0;top:100%;right:0;bottom:0;z-index:-1;cursor:default;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}:host ::ng-deep .textLayer .endOfContent.active{top:0}:host ::ng-deep .annotationLayer section{position:absolute;text-align:left;text-align:initial}:host ::ng-deep .annotationLayer .linkAnnotation>a,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.pushButton>a{position:absolute;font-size:1em;top:0;left:0;width:100%;height:100%}:host ::ng-deep .annotationLayer .linkAnnotation>a:hover,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.pushButton>a:hover{opacity:.2;background:yellow;box-shadow:0 2px 10px #ff0}:host ::ng-deep .annotationLayer .textAnnotation img{position:absolute;cursor:pointer}:host ::ng-deep .annotationLayer .textWidgetAnnotation input,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea{background-image:var(--annotation-unfocused-field-background);border:1px solid transparent;box-sizing:border-box;font-size:9px;height:100%;margin:0;padding:0 3px;vertical-align:top;width:100%}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select{background-image:var(--annotation-unfocused-field-background);border:1px solid transparent;box-sizing:border-box;font-size:9px;height:100%;margin:0;padding:0 3px;vertical-align:top;width:100%}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input{background-image:var(--annotation-unfocused-field-background);border:1px solid transparent;box-sizing:border-box;font-size:9px;height:100%;margin:0;padding:0 3px;vertical-align:top;width:100%}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select option{padding:0}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input{border-radius:50%}:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea{font:message-box;font-size:9px;resize:none}:host ::ng-deep .annotationLayer .textWidgetAnnotation input[disabled],:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea[disabled]{background:none;border:1px solid transparent;cursor:not-allowed}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select[disabled]{background:none;border:1px solid transparent;cursor:not-allowed}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input[disabled],:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input[disabled]{background:none;border:1px solid transparent;cursor:not-allowed}:host ::ng-deep .annotationLayer .textWidgetAnnotation input:hover,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea:hover{border:1px solid black}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select:hover{border:1px solid black}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:hover,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input:hover{border:1px solid black}:host ::ng-deep .annotationLayer .textWidgetAnnotation input:focus,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea:focus{background:none;border:1px solid transparent}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select:focus{background:none;border:1px solid transparent}:host ::ng-deep .annotationLayer .textWidgetAnnotation input :focus,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea :focus{background-image:none;background-color:transparent;outline:auto}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select :focus{background-image:none;background-color:transparent;outline:auto}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox :focus,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton :focus{background-image:none;background-color:transparent;outline:auto}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:before,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:after{background-color:#000;content:\"\";display:block;position:absolute}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input:checked:before{background-color:#000;content:\"\";display:block;position:absolute}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:before,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:after{height:80%;left:45%;width:1px}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:before{transform:rotate(45deg)}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:after{transform:rotate(-45deg)}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input:checked:before{border-radius:50%;height:50%;left:30%;top:20%;width:50%}:host ::ng-deep .annotationLayer .textWidgetAnnotation input.comb{font-family:monospace;padding-left:2px;padding-right:0}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input{-webkit-appearance:none;-moz-appearance:none;appearance:none;padding:0}:host ::ng-deep .annotationLayer .popupWrapper{position:absolute;width:20em}:host ::ng-deep .annotationLayer .popup{position:absolute;z-index:200;max-width:20em;background-color:#ff9;box-shadow:0 2px 5px #888;border-radius:2px;padding:6px;margin-left:5px;cursor:pointer;font:message-box;font-size:9px;white-space:normal;word-wrap:break-word}:host ::ng-deep .annotationLayer .popup>*{font-size:9px}:host ::ng-deep .annotationLayer .popup h1{display:inline-block}:host ::ng-deep .annotationLayer .popup span{display:inline-block;margin-left:5px}:host ::ng-deep .annotationLayer .popup p{border-top:1px solid #333333;margin-top:2px;padding-top:2px}:host ::ng-deep .annotationLayer .highlightAnnotation,:host ::ng-deep .annotationLayer .underlineAnnotation,:host ::ng-deep .annotationLayer .squigglyAnnotation,:host ::ng-deep .annotationLayer .strikeoutAnnotation,:host ::ng-deep .annotationLayer .freeTextAnnotation,:host ::ng-deep .annotationLayer .lineAnnotation svg line,:host ::ng-deep .annotationLayer .squareAnnotation svg rect,:host ::ng-deep .annotationLayer .circleAnnotation svg ellipse,:host ::ng-deep .annotationLayer .polylineAnnotation svg polyline,:host ::ng-deep .annotationLayer .polygonAnnotation svg polygon,:host ::ng-deep .annotationLayer .caretAnnotation,:host ::ng-deep .annotationLayer .inkAnnotation svg polyline,:host ::ng-deep .annotationLayer .stampAnnotation,:host ::ng-deep .annotationLayer .fileAttachmentAnnotation{cursor:pointer}:host ::ng-deep .xfaLayer .highlight{margin:-1px;padding:1px;background-color:#efcbed;border-radius:4px}:host ::ng-deep .xfaLayer .highlight.appended{position:static;position:initial}:host ::ng-deep .xfaLayer .highlight.begin{border-radius:4px 0 0 4px}:host ::ng-deep .xfaLayer .highlight.end{border-radius:0 4px 4px 0}:host ::ng-deep .xfaLayer .highlight.middle{border-radius:0}:host ::ng-deep .xfaLayer .highlight.selected{background-color:#cbdfcb}:host ::ng-deep .xfaLayer ::-moz-selection{background:blue}:host ::ng-deep .xfaLayer ::selection{background:blue}:host ::ng-deep .xfaPage{overflow:hidden;position:relative}:host ::ng-deep .xfaContentarea{position:absolute}:host ::ng-deep .xfaPrintOnly{display:none}:host ::ng-deep .xfaLayer{position:absolute;text-align:left;text-align:initial;top:0;left:0;transform-origin:0 0;line-height:1.2}:host ::ng-deep .xfaLayer *{color:inherit;font:inherit;font-style:inherit;font-weight:inherit;font-feature-settings:inherit;font-kerning:inherit;letter-spacing:-.01px;text-align:inherit;text-decoration:inherit;box-sizing:border-box;background-color:transparent;padding:0;margin:0;pointer-events:auto;line-height:inherit}:host ::ng-deep .xfaLayer div{pointer-events:none}:host ::ng-deep .xfaLayer svg{pointer-events:none}:host ::ng-deep .xfaLayer svg *{pointer-events:none}:host ::ng-deep .xfaLayer a{color:#00f}:host ::ng-deep .xfaRich li{margin-left:3em}:host ::ng-deep .xfaFont{color:#000;font-weight:400;font-feature-settings:\"kern\" off;font-kerning:none;font-size:10px;font-style:normal;letter-spacing:0;text-decoration:none;vertical-align:0}:host ::ng-deep .xfaCaption{overflow:hidden;flex:0 0 auto}:host ::ng-deep .xfaCaptionForCheckButton{overflow:hidden;flex:1 1 auto}:host ::ng-deep .xfaLabel{height:100%;width:100%}:host ::ng-deep .xfaLeft{display:flex;flex-direction:row;align-items:center}:host ::ng-deep .xfaRight{display:flex;flex-direction:row-reverse;align-items:center}:host ::ng-deep .xfaLeft>.xfaCaption,:host ::ng-deep .xfaLeft>.xfaCaptionForCheckButton{max-height:100%}:host ::ng-deep .xfaRight>.xfaCaption,:host ::ng-deep .xfaRight>.xfaCaptionForCheckButton{max-height:100%}:host ::ng-deep .xfaTop{display:flex;flex-direction:column;align-items:flex-start}:host ::ng-deep .xfaBottom{display:flex;flex-direction:column-reverse;align-items:flex-start}:host ::ng-deep .xfaTop>.xfaCaption,:host ::ng-deep .xfaTop>.xfaCaptionForCheckButton{width:100%}:host ::ng-deep .xfaBottom>.xfaCaption,:host ::ng-deep .xfaBottom>.xfaCaptionForCheckButton{width:100%}:host ::ng-deep .xfaBorder{background-color:transparent;position:absolute;pointer-events:none}:host ::ng-deep .xfaWrapped{width:100%;height:100%}:host ::ng-deep .xfaTextfield:focus,:host ::ng-deep .xfaSelect:focus{background-image:none;background-color:transparent;outline:auto;outline-offset:-1px}:host ::ng-deep .xfaCheckbox:focus,:host ::ng-deep .xfaRadio:focus{outline:auto}:host ::ng-deep .xfaTextfield,:host ::ng-deep .xfaSelect{height:100%;width:100%;flex:1 1 auto;border:none;resize:none;background-image:var(--xfa-unfocused-field-background)}:host ::ng-deep .xfaTop>.xfaTextfield,:host ::ng-deep .xfaTop>.xfaSelect{flex:0 1 auto}:host ::ng-deep .xfaBottom>.xfaTextfield,:host ::ng-deep .xfaBottom>.xfaSelect{flex:0 1 auto}:host ::ng-deep .xfaButton{cursor:pointer;width:100%;height:100%;border:none;text-align:center}:host ::ng-deep .xfaLink{width:100%;height:100%}:host ::ng-deep .xfaCheckbox,:host ::ng-deep .xfaRadio{width:100%;height:100%;flex:0 0 auto;border:none}:host ::ng-deep .xfaRich{white-space:pre-wrap;width:100%;height:100%}:host ::ng-deep .xfaImage{-o-object-position:left top;object-position:left top;-o-object-fit:contain;object-fit:contain;width:100%;height:100%}:host ::ng-deep .xfaLrTb,:host ::ng-deep .xfaRlTb,:host ::ng-deep .xfaTb{display:flex;flex-direction:column;align-items:stretch}:host ::ng-deep .xfaLr{display:flex;flex-direction:row;align-items:stretch}:host ::ng-deep .xfaRl{display:flex;flex-direction:row-reverse;align-items:stretch}:host ::ng-deep .xfaTb>div{justify-content:left}:host ::ng-deep .xfaPosition,:host ::ng-deep .xfaArea{position:relative}:host ::ng-deep .xfaValignMiddle{display:flex;align-items:center}:host ::ng-deep .xfaTable{display:flex;flex-direction:column;align-items:stretch}:host ::ng-deep .xfaTable .xfaRow{display:flex;flex-direction:row;align-items:stretch}:host ::ng-deep .xfaTable .xfaRlRow{display:flex;flex-direction:row-reverse;align-items:stretch;flex:1}:host ::ng-deep .xfaTable .xfaRlRow>div{flex:1}:host ::ng-deep .xfaNonInteractive input,:host ::ng-deep .xfaNonInteractive textarea{background:transparent none repeat 0 0 / auto auto padding-box border-box scroll;background:initial}:host ::ng-deep .xfaDisabled input,:host ::ng-deep .xfaDisabled textarea{background:transparent none repeat 0 0 / auto auto padding-box border-box scroll;background:initial}:host ::ng-deep .xfaReadOnly input,:host ::ng-deep .xfaReadOnly textarea{background:transparent none repeat 0 0 / auto auto padding-box border-box scroll;background:initial}@media print{:host ::ng-deep .xfaTextfield{background:transparent}:host ::ng-deep .xfaSelect{background:transparent;-webkit-appearance:none;-moz-appearance:none;appearance:none;text-indent:1px;text-overflow:\"\"}}:host ::ng-deep .pdfViewer{padding-bottom:var(--pdfViewer-padding-bottom)}:host ::ng-deep .pdfViewer .canvasWrapper{overflow:hidden}:host ::ng-deep .pdfViewer .page{direction:ltr;width:816px;height:1056px;margin:var(--page-margin);position:relative;overflow:visible;border:var(--page-border);background-clip:content-box;-o-border-image:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAQAAADYWf5HAAAA6UlEQVR4Xl2Pi2rEMAwE16fm1f7/r14v7w4rI0IzLAF7hLxNevBSEMEF5+OilNCsRd8ZMyn+a4NmsOT8WJw1lFbSYgGFzF2bLFoLjTClWjKKGRWpDYAGXUnZ4uhbBUzF3Oe/GG/ue2fn4GgsyXhNgysV2JnrhKEMg4fEZcALmiKbNhBBRFpSyDOj1G4QOVly6O1FV54ZZq8OVygrciDt6JazRgi1ljTPH0gbrPmHPXAbCiDd4GawIjip1TPh9tt2sz24qaCjr/jAb/GBFTbq9KZ7Ke/Cqt8nayUikZKsWZK7Fe6bg5dOUt8fZHWG2BHc+6EAAAAASUVORK5CYII=) 9 9 repeat;border-image:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAQAAADYWf5HAAAA6UlEQVR4Xl2Pi2rEMAwE16fm1f7/r14v7w4rI0IzLAF7hLxNevBSEMEF5+OilNCsRd8ZMyn+a4NmsOT8WJw1lFbSYgGFzF2bLFoLjTClWjKKGRWpDYAGXUnZ4uhbBUzF3Oe/GG/ue2fn4GgsyXhNgysV2JnrhKEMg4fEZcALmiKbNhBBRFpSyDOj1G4QOVly6O1FV54ZZq8OVygrciDt6JazRgi1ljTPH0gbrPmHPXAbCiDd4GawIjip1TPh9tt2sz24qaCjr/jAb/GBFTbq9KZ7Ke/Cqt8nayUikZKsWZK7Fe6bg5dOUt8fZHWG2BHc+6EAAAAASUVORK5CYII=) 9 9 repeat;background-color:#fff}:host ::ng-deep .pdfViewer.removePageBorders .page{margin:0 auto 10px;border:none}:host ::ng-deep .pdfViewer.singlePageView{display:inline-block}:host ::ng-deep .pdfViewer.singlePageView .page{margin:0;border:none}:host ::ng-deep .pdfViewer.scrollHorizontal,:host ::ng-deep .pdfViewer.scrollWrapped{margin-left:3.5px;margin-right:3.5px;text-align:center}:host ::ng-deep .spread{margin-left:3.5px;margin-right:3.5px;text-align:center}:host ::ng-deep .pdfViewer.scrollHorizontal,:host ::ng-deep .spread{white-space:nowrap}:host ::ng-deep .pdfViewer.removePageBorders,:host ::ng-deep .pdfViewer.scrollHorizontal .spread,:host ::ng-deep .pdfViewer.scrollWrapped .spread{margin-left:0;margin-right:0}:host ::ng-deep .spread .page{display:inline-block;vertical-align:middle}:host ::ng-deep .pdfViewer.scrollHorizontal .page,:host ::ng-deep .pdfViewer.scrollWrapped .page,:host ::ng-deep .pdfViewer.scrollHorizontal .spread,:host ::ng-deep .pdfViewer.scrollWrapped .spread{display:inline-block;vertical-align:middle}:host ::ng-deep .spread .page{margin-left:var(--spreadHorizontalWrapped-margin-LR);margin-right:var(--spreadHorizontalWrapped-margin-LR)}:host ::ng-deep .pdfViewer.scrollHorizontal .page,:host ::ng-deep .pdfViewer.scrollWrapped .page{margin-left:var(--spreadHorizontalWrapped-margin-LR);margin-right:var(--spreadHorizontalWrapped-margin-LR)}:host ::ng-deep .pdfViewer.removePageBorders .spread .page,:host ::ng-deep .pdfViewer.removePageBorders.scrollHorizontal .page,:host ::ng-deep .pdfViewer.removePageBorders.scrollWrapped .page{margin-left:5px;margin-right:5px}:host ::ng-deep .pdfViewer .page canvas{margin:0;display:block}:host ::ng-deep .pdfViewer .page canvas[hidden]{display:none}:host ::ng-deep .pdfViewer .page .loadingIcon{position:absolute;display:block;left:0;top:0;right:0;bottom:0;background:url(data:image/gif;base64,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) center no-repeat}:host ::ng-deep .pdfPresentationMode .pdfViewer{margin-left:0;margin-right:0}:host ::ng-deep .pdfPresentationMode .pdfViewer .page,:host ::ng-deep .pdfPresentationMode .pdfViewer .spread{display:block}:host ::ng-deep .pdfPresentationMode .pdfViewer .page,:host ::ng-deep .pdfPresentationMode .pdfViewer.removePageBorders .page{margin-left:auto;margin-right:auto}:host ::ng-deep .pdfPresentationMode:-webkit-full-screen .pdfViewer .page{margin-bottom:100%;border:0}:host ::ng-deep .pdfPresentationMode:-webkit-full-screen .pdfViewer .page,:host ::ng-deep .pdfPresentationMode:fullscreen .pdfViewer .page{margin-bottom:100%;border:0}\n"] });
i0.ɵɵngDeclareClassMetadata({ minVersion: "12.0.0", version: "13.1.3", ngImport: i0, type: PdfViewerComponent, decorators: [{
            type: Component,
            args: [{ selector: 'pdf-viewer', template: `
    <div #pdfViewerContainer class="ng2-pdf-viewer-container">
      <div class="pdfViewer"></div>
    </div>
  `, styles: [".ng2-pdf-viewer-container{overflow-x:auto;position:absolute;height:100%;width:100%;-webkit-overflow-scrolling:touch}:host{display:block;position:relative}:host ::ng-deep{--annotation-unfocused-field-background: url(\"data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>\");--xfa-unfocused-field-background: url(\"data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>\");--pdfViewer-padding-bottom: none;--page-margin: 1px auto -8px;--page-border: 9px solid transparent;--spreadHorizontalWrapped-margin-LR: -3.5px;--zoom-factor: 1}@media screen and (forced-colors: active){:host ::ng-deep{--pdfViewer-padding-bottom: 9px;--page-margin: 9px auto 0;--page-border: none;--spreadHorizontalWrapped-margin-LR: 4.5px}}:host ::ng-deep .textLayer{position:absolute;text-align:left;text-align:initial;left:0;top:0;right:0;bottom:0;overflow:hidden;opacity:.2;line-height:1}:host ::ng-deep .textLayer span,:host ::ng-deep .textLayer br{color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%}:host ::ng-deep .textLayer .highlight{margin:-1px;padding:1px;background-color:#b400aa;border-radius:4px}:host ::ng-deep .textLayer .highlight.appended{position:static;position:initial}:host ::ng-deep .textLayer .highlight.begin{border-radius:4px 0 0 4px}:host ::ng-deep .textLayer .highlight.end{border-radius:0 4px 4px 0}:host ::ng-deep .textLayer .highlight.middle{border-radius:0}:host ::ng-deep .textLayer .highlight.selected{background-color:#006400}:host ::ng-deep .textLayer ::-moz-selection{background:blue}:host ::ng-deep .textLayer ::selection{background:blue}:host ::ng-deep .textLayer br::-moz-selection{background:transparent}:host ::ng-deep .textLayer br::selection{background:transparent}:host ::ng-deep .textLayer .endOfContent{display:block;position:absolute;left:0;top:100%;right:0;bottom:0;z-index:-1;cursor:default;-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}:host ::ng-deep .textLayer .endOfContent.active{top:0}:host ::ng-deep .annotationLayer section{position:absolute;text-align:left;text-align:initial}:host ::ng-deep .annotationLayer .linkAnnotation>a,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.pushButton>a{position:absolute;font-size:1em;top:0;left:0;width:100%;height:100%}:host ::ng-deep .annotationLayer .linkAnnotation>a:hover,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.pushButton>a:hover{opacity:.2;background:yellow;box-shadow:0 2px 10px #ff0}:host ::ng-deep .annotationLayer .textAnnotation img{position:absolute;cursor:pointer}:host ::ng-deep .annotationLayer .textWidgetAnnotation input,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea{background-image:var(--annotation-unfocused-field-background);border:1px solid transparent;box-sizing:border-box;font-size:9px;height:100%;margin:0;padding:0 3px;vertical-align:top;width:100%}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select{background-image:var(--annotation-unfocused-field-background);border:1px solid transparent;box-sizing:border-box;font-size:9px;height:100%;margin:0;padding:0 3px;vertical-align:top;width:100%}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input{background-image:var(--annotation-unfocused-field-background);border:1px solid transparent;box-sizing:border-box;font-size:9px;height:100%;margin:0;padding:0 3px;vertical-align:top;width:100%}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select option{padding:0}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input{border-radius:50%}:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea{font:message-box;font-size:9px;resize:none}:host ::ng-deep .annotationLayer .textWidgetAnnotation input[disabled],:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea[disabled]{background:none;border:1px solid transparent;cursor:not-allowed}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select[disabled]{background:none;border:1px solid transparent;cursor:not-allowed}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input[disabled],:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input[disabled]{background:none;border:1px solid transparent;cursor:not-allowed}:host ::ng-deep .annotationLayer .textWidgetAnnotation input:hover,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea:hover{border:1px solid black}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select:hover{border:1px solid black}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:hover,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input:hover{border:1px solid black}:host ::ng-deep .annotationLayer .textWidgetAnnotation input:focus,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea:focus{background:none;border:1px solid transparent}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select:focus{background:none;border:1px solid transparent}:host ::ng-deep .annotationLayer .textWidgetAnnotation input :focus,:host ::ng-deep .annotationLayer .textWidgetAnnotation textarea :focus{background-image:none;background-color:transparent;outline:auto}:host ::ng-deep .annotationLayer .choiceWidgetAnnotation select :focus{background-image:none;background-color:transparent;outline:auto}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox :focus,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton :focus{background-image:none;background-color:transparent;outline:auto}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:before,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:after{background-color:#000;content:\"\";display:block;position:absolute}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input:checked:before{background-color:#000;content:\"\";display:block;position:absolute}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:before,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:after{height:80%;left:45%;width:1px}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:before{transform:rotate(45deg)}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input:checked:after{transform:rotate(-45deg)}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input:checked:before{border-radius:50%;height:50%;left:30%;top:20%;width:50%}:host ::ng-deep .annotationLayer .textWidgetAnnotation input.comb{font-family:monospace;padding-left:2px;padding-right:0}:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.checkBox input,:host ::ng-deep .annotationLayer .buttonWidgetAnnotation.radioButton input{-webkit-appearance:none;-moz-appearance:none;appearance:none;padding:0}:host ::ng-deep .annotationLayer .popupWrapper{position:absolute;width:20em}:host ::ng-deep .annotationLayer .popup{position:absolute;z-index:200;max-width:20em;background-color:#ff9;box-shadow:0 2px 5px #888;border-radius:2px;padding:6px;margin-left:5px;cursor:pointer;font:message-box;font-size:9px;white-space:normal;word-wrap:break-word}:host ::ng-deep .annotationLayer .popup>*{font-size:9px}:host ::ng-deep .annotationLayer .popup h1{display:inline-block}:host ::ng-deep .annotationLayer .popup span{display:inline-block;margin-left:5px}:host ::ng-deep .annotationLayer .popup p{border-top:1px solid #333333;margin-top:2px;padding-top:2px}:host ::ng-deep .annotationLayer .highlightAnnotation,:host ::ng-deep .annotationLayer .underlineAnnotation,:host ::ng-deep .annotationLayer .squigglyAnnotation,:host ::ng-deep .annotationLayer .strikeoutAnnotation,:host ::ng-deep .annotationLayer .freeTextAnnotation,:host ::ng-deep .annotationLayer .lineAnnotation svg line,:host ::ng-deep .annotationLayer .squareAnnotation svg rect,:host ::ng-deep .annotationLayer .circleAnnotation svg ellipse,:host ::ng-deep .annotationLayer .polylineAnnotation svg polyline,:host ::ng-deep .annotationLayer .polygonAnnotation svg polygon,:host ::ng-deep .annotationLayer .caretAnnotation,:host ::ng-deep .annotationLayer .inkAnnotation svg polyline,:host ::ng-deep .annotationLayer .stampAnnotation,:host ::ng-deep .annotationLayer .fileAttachmentAnnotation{cursor:pointer}:host ::ng-deep .xfaLayer .highlight{margin:-1px;padding:1px;background-color:#efcbed;border-radius:4px}:host ::ng-deep .xfaLayer .highlight.appended{position:static;position:initial}:host ::ng-deep .xfaLayer .highlight.begin{border-radius:4px 0 0 4px}:host ::ng-deep .xfaLayer .highlight.end{border-radius:0 4px 4px 0}:host ::ng-deep .xfaLayer .highlight.middle{border-radius:0}:host ::ng-deep .xfaLayer .highlight.selected{background-color:#cbdfcb}:host ::ng-deep .xfaLayer ::-moz-selection{background:blue}:host ::ng-deep .xfaLayer ::selection{background:blue}:host ::ng-deep .xfaPage{overflow:hidden;position:relative}:host ::ng-deep .xfaContentarea{position:absolute}:host ::ng-deep .xfaPrintOnly{display:none}:host ::ng-deep .xfaLayer{position:absolute;text-align:left;text-align:initial;top:0;left:0;transform-origin:0 0;line-height:1.2}:host ::ng-deep .xfaLayer *{color:inherit;font:inherit;font-style:inherit;font-weight:inherit;font-feature-settings:inherit;font-kerning:inherit;letter-spacing:-.01px;text-align:inherit;text-decoration:inherit;box-sizing:border-box;background-color:transparent;padding:0;margin:0;pointer-events:auto;line-height:inherit}:host ::ng-deep .xfaLayer div{pointer-events:none}:host ::ng-deep .xfaLayer svg{pointer-events:none}:host ::ng-deep .xfaLayer svg *{pointer-events:none}:host ::ng-deep .xfaLayer a{color:#00f}:host ::ng-deep .xfaRich li{margin-left:3em}:host ::ng-deep .xfaFont{color:#000;font-weight:400;font-feature-settings:\"kern\" off;font-kerning:none;font-size:10px;font-style:normal;letter-spacing:0;text-decoration:none;vertical-align:0}:host ::ng-deep .xfaCaption{overflow:hidden;flex:0 0 auto}:host ::ng-deep .xfaCaptionForCheckButton{overflow:hidden;flex:1 1 auto}:host ::ng-deep .xfaLabel{height:100%;width:100%}:host ::ng-deep .xfaLeft{display:flex;flex-direction:row;align-items:center}:host ::ng-deep .xfaRight{display:flex;flex-direction:row-reverse;align-items:center}:host ::ng-deep .xfaLeft>.xfaCaption,:host ::ng-deep .xfaLeft>.xfaCaptionForCheckButton{max-height:100%}:host ::ng-deep .xfaRight>.xfaCaption,:host ::ng-deep .xfaRight>.xfaCaptionForCheckButton{max-height:100%}:host ::ng-deep .xfaTop{display:flex;flex-direction:column;align-items:flex-start}:host ::ng-deep .xfaBottom{display:flex;flex-direction:column-reverse;align-items:flex-start}:host ::ng-deep .xfaTop>.xfaCaption,:host ::ng-deep .xfaTop>.xfaCaptionForCheckButton{width:100%}:host ::ng-deep .xfaBottom>.xfaCaption,:host ::ng-deep .xfaBottom>.xfaCaptionForCheckButton{width:100%}:host ::ng-deep .xfaBorder{background-color:transparent;position:absolute;pointer-events:none}:host ::ng-deep .xfaWrapped{width:100%;height:100%}:host ::ng-deep .xfaTextfield:focus,:host ::ng-deep .xfaSelect:focus{background-image:none;background-color:transparent;outline:auto;outline-offset:-1px}:host ::ng-deep .xfaCheckbox:focus,:host ::ng-deep .xfaRadio:focus{outline:auto}:host ::ng-deep .xfaTextfield,:host ::ng-deep .xfaSelect{height:100%;width:100%;flex:1 1 auto;border:none;resize:none;background-image:var(--xfa-unfocused-field-background)}:host ::ng-deep .xfaTop>.xfaTextfield,:host ::ng-deep .xfaTop>.xfaSelect{flex:0 1 auto}:host ::ng-deep .xfaBottom>.xfaTextfield,:host ::ng-deep .xfaBottom>.xfaSelect{flex:0 1 auto}:host ::ng-deep .xfaButton{cursor:pointer;width:100%;height:100%;border:none;text-align:center}:host ::ng-deep .xfaLink{width:100%;height:100%}:host ::ng-deep .xfaCheckbox,:host ::ng-deep .xfaRadio{width:100%;height:100%;flex:0 0 auto;border:none}:host ::ng-deep .xfaRich{white-space:pre-wrap;width:100%;height:100%}:host ::ng-deep .xfaImage{-o-object-position:left top;object-position:left top;-o-object-fit:contain;object-fit:contain;width:100%;height:100%}:host ::ng-deep .xfaLrTb,:host ::ng-deep .xfaRlTb,:host ::ng-deep .xfaTb{display:flex;flex-direction:column;align-items:stretch}:host ::ng-deep .xfaLr{display:flex;flex-direction:row;align-items:stretch}:host ::ng-deep .xfaRl{display:flex;flex-direction:row-reverse;align-items:stretch}:host ::ng-deep .xfaTb>div{justify-content:left}:host ::ng-deep .xfaPosition,:host ::ng-deep .xfaArea{position:relative}:host ::ng-deep .xfaValignMiddle{display:flex;align-items:center}:host ::ng-deep .xfaTable{display:flex;flex-direction:column;align-items:stretch}:host ::ng-deep .xfaTable .xfaRow{display:flex;flex-direction:row;align-items:stretch}:host ::ng-deep .xfaTable .xfaRlRow{display:flex;flex-direction:row-reverse;align-items:stretch;flex:1}:host ::ng-deep .xfaTable .xfaRlRow>div{flex:1}:host ::ng-deep .xfaNonInteractive input,:host ::ng-deep .xfaNonInteractive textarea{background:transparent none repeat 0 0 / auto auto padding-box border-box scroll;background:initial}:host ::ng-deep .xfaDisabled input,:host ::ng-deep .xfaDisabled textarea{background:transparent none repeat 0 0 / auto auto padding-box border-box scroll;background:initial}:host ::ng-deep .xfaReadOnly input,:host ::ng-deep .xfaReadOnly textarea{background:transparent none repeat 0 0 / auto auto padding-box border-box scroll;background:initial}@media print{:host ::ng-deep .xfaTextfield{background:transparent}:host ::ng-deep .xfaSelect{background:transparent;-webkit-appearance:none;-moz-appearance:none;appearance:none;text-indent:1px;text-overflow:\"\"}}:host ::ng-deep .pdfViewer{padding-bottom:var(--pdfViewer-padding-bottom)}:host ::ng-deep .pdfViewer .canvasWrapper{overflow:hidden}:host ::ng-deep .pdfViewer .page{direction:ltr;width:816px;height:1056px;margin:var(--page-margin);position:relative;overflow:visible;border:var(--page-border);background-clip:content-box;-o-border-image:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAQAAADYWf5HAAAA6UlEQVR4Xl2Pi2rEMAwE16fm1f7/r14v7w4rI0IzLAF7hLxNevBSEMEF5+OilNCsRd8ZMyn+a4NmsOT8WJw1lFbSYgGFzF2bLFoLjTClWjKKGRWpDYAGXUnZ4uhbBUzF3Oe/GG/ue2fn4GgsyXhNgysV2JnrhKEMg4fEZcALmiKbNhBBRFpSyDOj1G4QOVly6O1FV54ZZq8OVygrciDt6JazRgi1ljTPH0gbrPmHPXAbCiDd4GawIjip1TPh9tt2sz24qaCjr/jAb/GBFTbq9KZ7Ke/Cqt8nayUikZKsWZK7Fe6bg5dOUt8fZHWG2BHc+6EAAAAASUVORK5CYII=) 9 9 repeat;border-image:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABMAAAATCAQAAADYWf5HAAAA6UlEQVR4Xl2Pi2rEMAwE16fm1f7/r14v7w4rI0IzLAF7hLxNevBSEMEF5+OilNCsRd8ZMyn+a4NmsOT8WJw1lFbSYgGFzF2bLFoLjTClWjKKGRWpDYAGXUnZ4uhbBUzF3Oe/GG/ue2fn4GgsyXhNgysV2JnrhKEMg4fEZcALmiKbNhBBRFpSyDOj1G4QOVly6O1FV54ZZq8OVygrciDt6JazRgi1ljTPH0gbrPmHPXAbCiDd4GawIjip1TPh9tt2sz24qaCjr/jAb/GBFTbq9KZ7Ke/Cqt8nayUikZKsWZK7Fe6bg5dOUt8fZHWG2BHc+6EAAAAASUVORK5CYII=) 9 9 repeat;background-color:#fff}:host ::ng-deep .pdfViewer.removePageBorders .page{margin:0 auto 10px;border:none}:host ::ng-deep .pdfViewer.singlePageView{display:inline-block}:host ::ng-deep .pdfViewer.singlePageView .page{margin:0;border:none}:host ::ng-deep .pdfViewer.scrollHorizontal,:host ::ng-deep .pdfViewer.scrollWrapped{margin-left:3.5px;margin-right:3.5px;text-align:center}:host ::ng-deep .spread{margin-left:3.5px;margin-right:3.5px;text-align:center}:host ::ng-deep .pdfViewer.scrollHorizontal,:host ::ng-deep .spread{white-space:nowrap}:host ::ng-deep .pdfViewer.removePageBorders,:host ::ng-deep .pdfViewer.scrollHorizontal .spread,:host ::ng-deep .pdfViewer.scrollWrapped .spread{margin-left:0;margin-right:0}:host ::ng-deep .spread .page{display:inline-block;vertical-align:middle}:host ::ng-deep .pdfViewer.scrollHorizontal .page,:host ::ng-deep .pdfViewer.scrollWrapped .page,:host ::ng-deep .pdfViewer.scrollHorizontal .spread,:host ::ng-deep .pdfViewer.scrollWrapped .spread{display:inline-block;vertical-align:middle}:host ::ng-deep .spread .page{margin-left:var(--spreadHorizontalWrapped-margin-LR);margin-right:var(--spreadHorizontalWrapped-margin-LR)}:host ::ng-deep .pdfViewer.scrollHorizontal .page,:host ::ng-deep .pdfViewer.scrollWrapped .page{margin-left:var(--spreadHorizontalWrapped-margin-LR);margin-right:var(--spreadHorizontalWrapped-margin-LR)}:host ::ng-deep .pdfViewer.removePageBorders .spread .page,:host ::ng-deep .pdfViewer.removePageBorders.scrollHorizontal .page,:host ::ng-deep .pdfViewer.removePageBorders.scrollWrapped .page{margin-left:5px;margin-right:5px}:host ::ng-deep .pdfViewer .page canvas{margin:0;display:block}:host ::ng-deep .pdfViewer .page canvas[hidden]{display:none}:host ::ng-deep .pdfViewer .page .loadingIcon{position:absolute;display:block;left:0;top:0;right:0;bottom:0;background:url(data:image/gif;base64,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) center no-repeat}:host ::ng-deep .pdfPresentationMode .pdfViewer{margin-left:0;margin-right:0}:host ::ng-deep .pdfPresentationMode .pdfViewer .page,:host ::ng-deep .pdfPresentationMode .pdfViewer .spread{display:block}:host ::ng-deep .pdfPresentationMode .pdfViewer .page,:host ::ng-deep .pdfPresentationMode .pdfViewer.removePageBorders .page{margin-left:auto;margin-right:auto}:host ::ng-deep .pdfPresentationMode:-webkit-full-screen .pdfViewer .page{margin-bottom:100%;border:0}:host ::ng-deep .pdfPresentationMode:-webkit-full-screen .pdfViewer .page,:host ::ng-deep .pdfPresentationMode:fullscreen .pdfViewer .page{margin-bottom:100%;border:0}\n"] }]
        }], ctorParameters: function () { return [{ type: i0.ElementRef }, { type: i0.NgZone }]; }, propDecorators: { pdfViewerContainer: [{
                type: ViewChild,
                args: ['pdfViewerContainer']
            }], afterLoadComplete: [{
                type: Output,
                args: ['after-load-complete']
            }], pageRendered: [{
                type: Output,
                args: ['page-rendered']
            }], pageInitialized: [{
                type: Output,
                args: ['pages-initialized']
            }], textLayerRendered: [{
                type: Output,
                args: ['text-layer-rendered']
            }], onError: [{
                type: Output,
                args: ['error']
            }], onProgress: [{
                type: Output,
                args: ['on-progress']
            }], pageChange: [{
                type: Output
            }], src: [{
                type: Input
            }], cMapsUrl: [{
                type: Input,
                args: ['c-maps-url']
            }], page: [{
                type: Input,
                args: ['page']
            }], renderText: [{
                type: Input,
                args: ['render-text']
            }], renderTextMode: [{
                type: Input,
                args: ['render-text-mode']
            }], originalSize: [{
                type: Input,
                args: ['original-size']
            }], showAll: [{
                type: Input,
                args: ['show-all']
            }], stickToPage: [{
                type: Input,
                args: ['stick-to-page']
            }], zoom: [{
                type: Input,
                args: ['zoom']
            }], zoomScale: [{
                type: Input,
                args: ['zoom-scale']
            }], rotation: [{
                type: Input,
                args: ['rotation']
            }], externalLinkTarget: [{
                type: Input,
                args: ['external-link-target']
            }], autoresize: [{
                type: Input,
                args: ['autoresize']
            }], fitToPage: [{
                type: Input,
                args: ['fit-to-page']
            }], showBorders: [{
                type: Input,
                args: ['show-borders']
            }] } });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGRmLXZpZXdlci5jb21wb25lbnQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi9zcmMvYXBwL3BkZi12aWV3ZXIvcGRmLXZpZXdlci5jb21wb25lbnQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7O0dBRUc7QUFDSCxPQUFPLEVBQ0wsU0FBUyxFQUNULEtBQUssRUFDTCxNQUFNLEVBRU4sWUFBWSxFQUtaLFNBQVMsRUFHVixNQUFNLGVBQWUsQ0FBQztBQUN2QixPQUFPLEVBQUUsSUFBSSxFQUFFLFNBQVMsRUFBRSxPQUFPLEVBQUUsTUFBTSxNQUFNLENBQUM7QUFDaEQsT0FBTyxFQUFFLFlBQVksRUFBRSxNQUFNLEVBQUUsU0FBUyxFQUFFLE1BQU0sZ0JBQWdCLENBQUM7QUFDakUsT0FBTyxLQUFLLEtBQUssTUFBTSw2QkFBNkIsQ0FBQztBQUNyRCxPQUFPLEtBQUssV0FBVyxNQUFNLGtDQUFrQyxDQUFDO0FBRWhFLE9BQU8sRUFBRSxjQUFjLEVBQUUsTUFBTSwwQkFBMEIsQ0FBQztBQUMxRCxPQUFPLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxNQUFNLGtCQUFrQixDQUFDOztBQVdqRCxJQUFJLENBQUMsS0FBSyxFQUFFLEVBQUU7SUFDWixNQUFNLENBQUMsS0FBSyxFQUFFLFdBQVcsRUFBRSxLQUFLLENBQUMsY0FBYyxDQUFDLEtBQUssQ0FBQyxDQUFDO0NBQ3hEO0FBRUQsTUFBTSxDQUFOLElBQVksY0FJWDtBQUpELFdBQVksY0FBYztJQUN4QiwyREFBUSxDQUFBO0lBQ1IseURBQU8sQ0FBQTtJQUNQLDJEQUFRLENBQUE7QUFDVixDQUFDLEVBSlcsY0FBYyxLQUFkLGNBQWMsUUFJekI7QUFXRCxNQUFNLE9BQU8sa0JBQWtCO0lBc0s3QixZQUFvQixPQUFnQyxFQUFVLE1BQWM7UUFBeEQsWUFBTyxHQUFQLE9BQU8sQ0FBeUI7UUFBVSxXQUFNLEdBQU4sTUFBTSxDQUFRO1FBL0pwRSxjQUFTLEdBQUcsS0FB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TUFBTTt1QkFBQyxPQUFPO2dCQUNRLFVBQVU7c0JBQWhDLE1BQU07dUJBQUMsYUFBYTtnQkFDWCxVQUFVO3NCQUFuQixNQUFNO2dCQUNFLEdBQUc7c0JBQVgsS0FBSztnQkFHRixRQUFRO3NCQURYLEtBQUs7dUJBQUMsWUFBWTtnQkFNZixJQUFJO3NCQURQLEtBQUs7dUJBQUMsTUFBTTtnQkFnQlQsVUFBVTtzQkFEYixLQUFLO3VCQUFDLGFBQWE7Z0JBTWhCLGNBQWM7c0JBRGpCLEtBQUs7dUJBQUMsa0JBQWtCO2dCQU1yQixZQUFZO3NCQURmLEtBQUs7dUJBQUMsZUFBZTtnQkFNbEIsT0FBTztzQkFEVixLQUFLO3VCQUFDLFVBQVU7Z0JBTWIsV0FBVztzQkFEZCxLQUFLO3VCQUFDLGVBQWU7Z0JBTWxCLElBQUk7c0JBRFAsS0FBSzt1QkFBQyxNQUFNO2dCQWNULFNBQVM7c0JBRFosS0FBSzt1QkFBQyxZQUFZO2dCQVVmLFFBQVE7c0JBRFgsS0FBSzt1QkFBQyxVQUFVO2dCQVdiLGtCQUFrQjtzQkFEckIsS0FBSzt1QkFBQyxzQkFBc0I7Z0JBTXpCLFVBQVU7c0JBRGIsS0FBSzt1QkFBQyxZQUFZO2dCQU1mLFNBQVM7c0JBRFosS0FBSzt1QkFBQyxhQUFhO2dCQU1oQixXQUFXO3NCQURkLEtBQUs7dUJBQUMsY0FBYyIsInNvdXJjZXNDb250ZW50IjpbIi8qKlxuICogQ3JlYXRlZCBieSB2YWRpbWRleiBvbiAyMS8wNi8xNi5cbiAqL1xuaW1wb3J0IHtcbiAgQ29tcG9uZW50LFxuICBJbnB1dCxcbiAgT3V0cHV0LFxuICBFbGVtZW50UmVmLFxuICBFdmVudEVtaXR0ZXIsXG4gIE9uQ2hhbmdlcyxcbiAgU2ltcGxlQ2hhbmdlcyxcbiAgT25Jbml0LFxuICBPbkRlc3Ryb3ksXG4gIFZpZXdDaGlsZCxcbiAgQWZ0ZXJWaWV3Q2hlY2tlZCxcbiAgTmdab25lXG59IGZyb20gJ0Bhbmd1bGFyL2NvcmUnO1xuaW1wb3J0IHsgZnJvbSwgZnJvbUV2ZW50LCBTdWJqZWN0IH0gZnJvbSAncnhqcyc7XG5pbXBvcnQgeyBkZWJvdW5jZVRpbWUsIGZpbHRlciwgdGFrZVVudGlsIH0gZnJvbSAncnhqcy9vcGVyYXRvcnMnO1xuaW1wb3J0ICogYXMgUERGSlMgZnJvbSAncGRmanMtZGlzdC9sZWdhY3kvYnVpbGQvcGRmJztcbmltcG9ydCAqIGFzIFBERkpTVmlld2VyIGZyb20gJ3BkZmpzLWRpc3QvbGVnYWN5L3dlYi9wZGZfdmlld2VyJztcblxuaW1wb3J0IHsgY3JlYXRlRXZlbnRCdXMgfSBmcm9tICcuLi91dGlscy9ldmVudC1idXMtdXRpbHMnO1xuaW1wb3J0IHsgYXNzaWduLCBpc1NTUiB9IGZyb20gJy4uL3V0aWxzL2hlbHBlcnMnO1xuXG5pbXBvcnQgdHlwZSB7XG4gIFBERlNvdXJjZSxcbiAgUERGUGFnZVByb3h5LFxuICBQREZQcm9ncmVzc0RhdGEsXG4gIFBERkRvY3VtZW50UHJveHksXG4gIFBERkRvY3VtZW50TG9hZGluZ1Rhc2ssXG4gIFBERlZpZXdlck9wdGlvbnNcbn0gZnJvbSAnLi90eXBpbmdzJztcblxuaWYgKCFpc1NTUigpKSB7XG4gIGFzc2lnbihQREZKUywgJ3ZlcmJvc2l0eScsIFBERkpTLlZlcmJvc2l0eUxldmVsLklORk9TKTtcbn1cblxuZXhwb3J0IGVudW0gUmVuZGVyVGV4dE1vZGUge1xuICBESVNBQkxFRCxcbiAgRU5BQkxFRCxcbiAgRU5IQU5DRURcbn1cblxuQENvbXBvbmVudCh7XG4gIHNlbGVjdG9yOiAncGRmLXZpZXdlcicsXG4gIHRlbXBsYXRlOiBgXG4gICAgPGRpdiAjcGRmVmlld2VyQ29udGFpbmVyIGNsYXNzPVwibmcyLXBkZi12aWV3ZXItY29udGFpbmVyXCI+XG4gICAgICA8ZGl2IGNsYXNzPVwicGRmVmlld2VyXCI+PC9kaXY+XG4gICAgPC9kaXY+XG4gIGAsXG4gIHN0eWxlVXJsczogWycuL3BkZi12aWV3ZXIuY29tcG9uZW50LnNjc3MnXVxufSlcbmV4cG9ydCBjbGFzcyBQZGZWaWV3ZXJDb21wb25lbnRcbiAgaW1wbGVtZW50cyBPbkNoYW5nZXMsIE9uSW5pdCwgT25EZXN0cm95LCBBZnRlclZpZXdDaGVja2VkIHtcbiAgc3RhdGljIENTU19VTklUUyA9IDk2LjAgLyA3Mi4wO1xuICBzdGF0aWMgQk9SREVSX1dJRFRIID0gOTtcblxuICBAVmlld0NoaWxkKCdwZGZWaWV3ZXJDb250YWluZXInKSBwZGZWaWV3ZXJDb250YWluZXI7XG5cbiAgcHJpdmF0ZSBpc1Zpc2libGUgPSBmYWxzZTtcbiAgcHJpdmF0ZSBwZGZNdWx0aVBhZ2VWaWV3ZXI6IGFueTtcbiAgcHJpdmF0ZSBwZGZNdWx0aVBhZ2VMaW5rU2VydmljZTogYW55O1xuICBwcml2YXRlIHBkZk11bHRpUGFnZUZpbmRDb250cm9sbGVyOiBhbnk7XG5cbiAgcHJpdmF0ZSBwZGZTaW5nbGVQYWdlVmlld2VyOiBhbnk7XG4gIHByaXZhdGUgcGRmU2luZ2xlUGFnZUxpbmtTZXJ2aWNlOiBhbnk7XG4gIHByaXZhdGUgcGRmU2luZ2xlUGFnZUZpbmRDb250cm9sbGVyOiBhbnk7XG5cbiAgcHJpdmF0ZSBfY01hcHNVcmwgPVxuICAgIHR5cGVvZiBQREZKUyAhPT0gJ3VuZGVmaW5lZCdcbiAgICAgID8gYGh0dHBzOi8vdW5wa2cuY29tL3BkZmpzLWRpc3RAJHsoUERGSlMgYXMgYW55KS52ZXJzaW9ufS9jbWFwcy9gXG4gICAgICA6IG51bGw7XG4gIHByaXZhdGUgX3JlbmRlclRleHQgPSB0cnVlO1xuICBwcml2YXRlIF9yZW5kZXJUZXh0TW9kZTogUmVuZGVyVGV4dE1vZGUgPSBSZW5kZXJUZXh0TW9kZS5FTkFCTEVEO1xuICBwcml2YXRlIF9zdGlja1RvUGFnZSA9IGZhbHNlO1xuICBwcml2YXRlIF9vcmlnaW5hbFNpemUgPSB0cnVlO1xuICBwcml2YXRlIF9wZGY6IFBERkRvY3VtZW50UHJveHk7XG4gIHByaXZhdGUgX3BhZ2UgPSAxO1xuICBwcml2YXRlIF96b29tID0gMTtcbiAgcHJpdmF0ZSBfem9vbVNjYWxlOiAncGFnZS1oZWlnaHQnIHwgJ3BhZ2UtZml0JyB8ICdwYWdlLXdpZHRoJyA9ICdwYWdlLXdpZHRoJztcbiAgcHJpdmF0ZSBfcm90YXRpb24gPSAwO1xuICBwcml2YXRlIF9zaG93QWxsID0gdHJ1ZTtcbiAgcHJpdmF0ZSBfY2FuQXV0b1Jlc2l6ZSA9IHRydWU7XG4gIHByaXZhdGUgX2ZpdFRvUGFnZSA9IGZhbHNlO1xuICBwcml2YXRlIF9leHRlcm5hbExpbmtUYXJnZXQgPSAnYmxhbmsnO1xuICBwcml2YXRlIF9zaG93Qm9yZGVycyA9IGZhbHNlO1xuICBwcml2YXRlIGxhc3RMb2FkZWQ6IHN0cmluZyB8IFVpbnQ4QXJyYXkgfCBQREZTb3VyY2U7XG4gIHByaXZhdGUgX2xhdGVzdFNjcm9sbGVkUGFnZTogbnVtYmVyO1xuXG4gIHByaXZhdGUgcmVzaXplVGltZW91dDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcGFnZVNjcm9sbFRpbWVvdXQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGlzSW5pdGlhbGl6ZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBsb2FkaW5nVGFzazogUERGRG9jdW1lbnRMb2FkaW5nVGFzaztcbiAgcHJpdmF0ZSBkZXN0cm95JCA9IG5ldyBTdWJqZWN0PHZvaWQ+KCk7XG5cbiAgQE91dHB1dCgnYWZ0ZXItbG9hZC1jb21wbGV0ZScpIGFmdGVyTG9hZENvbXBsZXRlID0gbmV3IEV2ZW50RW1pdHRlcjxQREZEb2N1bWVudFByb3h5PigpO1xuICBAT3V0cHV0KCdwYWdlLXJlbmRlcmVkJykgcGFnZVJlbmRlcmVkID0gbmV3IEV2ZW50RW1pdHRlcjxDdXN0b21FdmVudD4oKTtcbiAgQE91dHB1dCgncGFnZXMtaW5pdGlhbGl6ZWQnKSBwYWdlSW5pdGlhbGl6ZWQgPSBuZXcgRXZlbnRFbWl0dGVyPEN1c3RvbUV2ZW50PigpO1xuICBAT3V0cHV0KCd0ZXh0LWxheWVyLXJlbmRlcmVkJykgdGV4dExheWVyUmVuZGVyZWQgPSBuZXcgRXZlbnRFbWl0dGVyPEN1c3RvbUV2ZW50PigpO1xuICBAT3V0cHV0KCdlcnJvcicpIG9uRXJyb3IgPSBuZXcgRXZlbnRFbWl0dGVyPGFueT4oKTtcbiAgQE91dHB1dCgnb24tcHJvZ3Jlc3MnKSBvblByb2dyZXNzID0gbmV3IEV2ZW50RW1pdHRlcjxQREZQcm9ncmVzc0RhdGE+KCk7XG4gIEBPdXRwdXQoKSBwYWdlQ2hhbmdlOiBFdmVudEVtaXR0ZXI8bnVtYmVyPiA9IG5ldyBFdmVudEVtaXR0ZXI8bnVtYmVyPih0cnVlKTtcbiAgQElucHV0KCkgc3JjOiBzdHJpbmcgfCBVaW50OEFycmF5IHwgUERGU291cmNlO1xuXG4gIEBJbnB1dCgnYy1tYXBzLXVybCcpXG4gIHNldCBjTWFwc1VybChjTWFwc1VybDogc3RyaW5nKSB7XG4gICAgdGhpcy5fY01hcHNVcmwgPSBjTWFwc1VybDtcbiAgfVxuXG4gIEBJbnB1dCgncGFnZScpXG4gIHNldCBwYWdlKF9wYWdlKSB7XG4gICAgX3BhZ2UgPSBwYXJzZUludChfcGFnZSwgMTApIHx8IDE7XG4gICAgY29uc3Qgb3JpZ2luYWxQYWdlID0gX3BhZ2U7XG5cbiAgICBpZiAodGhpcy5fcGRmKSB7XG4gICAgICBfcGFnZSA9IHRoaXMuZ2V0VmFsaWRQYWdlTnVtYmVyKF9wYWdlKTtcbiAgICB9XG5cbiAgICB0aGlzLl9wYWdlID0gX3BhZ2U7XG4gICAgaWYgKG9yaWdpbmFsUGFnZSAhPT0gX3BhZ2UpIHtcbiAgICAgIHRoaXMucGFnZUNoYW5nZS5lbWl0KF9wYWdlKTtcbiAgICB9XG4gIH1cblxuICBASW5wdXQoJ3JlbmRlci10ZXh0JylcbiAgc2V0IHJlbmRlclRleHQocmVuZGVyVGV4dDogYm9vbGVhbikge1xuICAgIHRoaXMuX3JlbmRlclRleHQgPSByZW5kZXJUZXh0O1xuICB9XG5cbiAgQElucHV0KCdyZW5kZXItdGV4dC1tb2RlJylcbiAgc2V0IHJlbmRlclRleHRNb2RlKHJlbmRlclRleHRNb2RlOiBSZW5kZXJUZXh0TW9kZSkge1xuICAgIHRoaXMuX3JlbmRlclRleHRNb2RlID0gcmVuZGVyVGV4dE1vZGU7XG4gIH1cblxuICBASW5wdXQoJ29yaWdpbmFsLXNpemUnKVxuICBzZXQgb3JpZ2luYWxTaXplKG9yaWdpbmFsU2l6ZTogYm9vbGVhbikge1xuICAgIHRoaXMuX29yaWdpbmFsU2l6ZSA9IG9yaWdpbmFsU2l6ZTtcbiAgfVxuXG4gIEBJbnB1dCgnc2hvdy1hbGwnKVxuICBzZXQgc2hvd0FsbCh2YWx1ZTogYm9vbGVhbikge1xuICAgIHRoaXMuX3Nob3dBbGwgPSB2YWx1ZTtcbiAgfVxuXG4gIEBJbnB1dCgnc3RpY2stdG8tcGFnZScpXG4gIHNldCBzdGlja1RvUGFnZSh2YWx1ZTogYm9vbGVhbikge1xuICAgIHRoaXMuX3N0aWNrVG9QYWdlID0gdmFsdWU7XG4gIH1cblxuICBASW5wdXQoJ3pvb20nKVxuICBzZXQgem9vbSh2YWx1ZTogbnVtYmVyKSB7XG4gICAgaWYgKHZhbHVlIDw9IDApIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLl96b29tID0gdmFsdWU7XG4gIH1cblxuICBnZXQgem9vbSgpIHtcbiAgICByZXR1cm4gdGhpcy5fem9vbTtcbiAgfVxuXG4gIEBJbnB1dCgnem9vbS1zY2FsZScpXG4gIHNldCB6b29tU2NhbGUodmFsdWU6ICdwYWdlLWhlaWdodCcgfCAncGFnZS1maXQnIHwgJ3BhZ2Utd2lkdGgnKSB7XG4gICAgdGhpcy5fem9vbVNjYWxlID0gdmFsdWU7XG4gIH1cblxuICBnZXQgem9vbVNjYWxlKCkge1xuICAgIHJldHVybiB0aGlzLl96b29tU2NhbGU7XG4gIH1cblxuICBASW5wdXQoJ3JvdGF0aW9uJylcbiAgc2V0IHJvdGF0aW9uKHZhbHVlOiBudW1iZXIpIHtcbiAgICBpZiAoISh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIHZhbHVlICUgOTAgPT09IDApKSB7XG4gICAgICBjb25zb2xlLndhcm4oJ0ludmFsaWQgcGFnZXMgcm90YXRpb24gYW5nbGUuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5fcm90YXRpb24gPSB2YWx1ZTtcbiAgfVxuXG4gIEBJbnB1dCgnZXh0ZXJuYWwtbGluay10YXJnZXQnKVxuICBzZXQgZXh0ZXJuYWxMaW5rVGFyZ2V0KHZhbHVlOiBzdHJpbmcpIHtcbiAgICB0aGlzLl9leHRlcm5hbExpbmtUYXJnZXQgPSB2YWx1ZTtcbiAgfVxuXG4gIEBJbnB1dCgnYXV0b3Jlc2l6ZScpXG4gIHNldCBhdXRvcmVzaXplKHZhbHVlOiBib29sZWFuKSB7XG4gICAgdGhpcy5fY2FuQXV0b1Jlc2l6ZSA9IEJvb2xlYW4odmFsdWUpO1xuICB9XG5cbiAgQElucHV0KCdmaXQtdG8tcGFnZScpXG4gIHNldCBmaXRUb1BhZ2UodmFsdWU6IGJvb2xlYW4pIHtcbiAgICB0aGlzLl9maXRUb1BhZ2UgPSBCb29sZWFuKHZhbHVlKTtcbiAgfVxuXG4gIEBJbnB1dCgnc2hvdy1ib3JkZXJzJylcbiAgc2V0IHNob3dCb3JkZXJzKHZhbHVlOiBib29sZWFuKSB7XG4gICAgdGhpcy5fc2hvd0JvcmRlcnMgPSBCb29sZWFuKHZhbHVlKTtcbiAgfVxuXG4gIHN0YXRpYyBnZXRMaW5rVGFyZ2V0KHR5cGU6IHN0cmluZykge1xuICAgIHN3aXRjaCAodHlwZSkge1xuICAgICAgY2FzZSAnYmxhbmsnOlxuICAgICAgICByZXR1cm4gKFBERkpTIGFzIGFueSkuTGlua1RhcmdldC5CTEFOSztcbiAgICAgIGNhc2UgJ25vbmUnOlxuICAgICAgICByZXR1cm4gKFBERkpTIGFzIGFueSkuTGlua1RhcmdldC5OT05FO1xuICAgICAgY2FzZSAnc2VsZic6XG4gICAgICAgIHJldHVybiAoUERGSlMgYXMgYW55KS5MaW5rVGFyZ2V0LlNFTEY7XG4gICAgICBjYXNlICdwYXJlbnQnOlxuICAgICAgICByZXR1cm4gKFBERkpTIGFzIGFueSkuTGlua1RhcmdldC5QQVJFTlQ7XG4gICAgICBjYXNlICd0b3AnOlxuICAgICAgICByZXR1cm4gKFBERkpTIGFzIGFueSkuTGlua1RhcmdldC5UT1A7XG4gICAgfVxuXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGVsZW1lbnQ6IEVsZW1lbnRSZWY8SFRNTEVsZW1lbnQ+LCBwcml2YXRlIG5nWm9uZTogTmdab25lKSB7XG4gICAgaWYgKGlzU1NSKCkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBsZXQgcGRmV29ya2VyU3JjOiBzdHJpbmc7XG5cbiAgICBpZiAoXG4gICAgICB3aW5kb3cuaGFzT3duUHJvcGVydHkoJ3BkZldvcmtlclNyYycpICYmXG4gICAgICB0eXBlb2YgKHdpbmRvdyBhcyBhbnkpLnBkZldvcmtlclNyYyA9PT0gJ3N0cmluZycgJiZcbiAgICAgICh3aW5kb3cgYXMgYW55KS5wZGZXb3JrZXJTcmNcbiAgICApIHtcbiAgICAgIHBkZldvcmtlclNyYyA9ICh3aW5kb3cgYXMgYW55KS5wZGZXb3JrZXJTcmM7XG4gICAgfSBlbHNlIHtcbiAgICAgIHBkZldvcmtlclNyYyA9IGBodHRwczovL2Nkbi5qc2RlbGl2ci5uZXQvbnBtL3BkZmpzLWRpc3RAJHsoUERGSlMgYXMgYW55KS52ZXJzaW9uXG4gICAgICAgIH0vbGVnYWN5L2J1aWxkL3BkZi53b3JrZXIuanNgO1xuICAgIH1cblxuICAgIGFzc2lnbihQREZKUy5HbG9iYWxXb3JrZXJPcHRpb25zLCAnd29ya2VyU3JjJywgcGRmV29ya2VyU3JjKTtcbiAgfVxuXG4gIG5nQWZ0ZXJWaWV3Q2hlY2tlZCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pc0luaXRpYWxpemVkKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3Qgb2Zmc2V0ID0gdGhpcy5wZGZWaWV3ZXJDb250YWluZXIubmF0aXZlRWxlbWVudC5vZmZzZXRQYXJlbnQ7XG5cbiAgICBpZiAodGhpcy5pc1Zpc2libGUgPT09IHRydWUgJiYgb2Zmc2V0ID09IG51bGwpIHtcbiAgICAgIHRoaXMuaXNWaXNpYmxlID0gZmFsc2U7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaXNWaXNpYmxlID09PSBmYWxzZSAmJiBvZmZzZXQgIT0gbnVsbCkge1xuICAgICAgdGhpcy5pc1Zpc2libGUgPSB0cnVlO1xuXG4gICAgICBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgdGhpcy5pbml0aWFsaXplKCk7XG4gICAgICAgIHRoaXMubmdPbkNoYW5nZXMoeyBzcmM6IHRoaXMuc3JjIH0gYXMgYW55KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIG5nT25Jbml0KCkge1xuICAgIHRoaXMuaW5pdGlhbGl6ZSgpO1xuICAgIHRoaXMuc2V0dXBSZXNpemVMaXN0ZW5lcigpO1xuICB9XG5cbiAgbmdPbkRlc3Ryb3koKSB7XG4gICAgdGhpcy5jbGVhcigpO1xuICAgIHRoaXMuZGVzdHJveSQubmV4dCgpO1xuICAgIHRoaXMubG9hZGluZ1Rhc2sgPSBudWxsO1xuICB9XG5cbiAgZ2V0IHBkZkxpbmtTZXJ2aWNlKCk6IGFueSB7XG4gICAgcmV0dXJuIHRoaXMuX3Nob3dBbGxcbiAgICAgID8gdGhpcy5wZGZNdWx0aVBhZ2VMaW5rU2VydmljZVxuICAgICAgOiB0aGlzLnBkZlNpbmdsZVBhZ2VMaW5rU2VydmljZTtcbiAgfVxuXG4gIGdldCBwZGZWaWV3ZXIoKTogYW55IHtcbiAgICByZXR1cm4gdGhpcy5nZXRDdXJyZW50Vmlld2VyKCk7XG4gIH1cblxuICBnZXQgcGRmRmluZENvbnRyb2xsZXIoKTogYW55IHtcbiAgICByZXR1cm4gdGhpcy5fc2hvd0FsbFxuICAgICAgPyB0aGlzLnBkZk11bHRpUGFnZUZpbmRDb250cm9sbGVyXG4gICAgICA6IHRoaXMucGRmU2luZ2xlUGFnZUZpbmRDb250cm9sbGVyO1xuICB9XG5cbiAgbmdPbkNoYW5nZXMoY2hhbmdlczogU2ltcGxlQ2hhbmdlcykge1xuICAgIGlmIChpc1NTUigpIHx8ICF0aGlzLmlzVmlzaWJsZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICgnc3JjJyBpbiBjaGFuZ2VzKSB7XG4gICAgICB0aGlzLmxvYWRQREYoKTtcbiAgICB9IGVsc2UgaWYgKHRoaXMuX3BkZikge1xuICAgICAgaWYgKCdyZW5kZXJUZXh0JyBpbiBjaGFuZ2VzKSB7XG4gICAgICAgIHRoaXMuZ2V0Q3VycmVudFZpZXdlcigpLnRleHRMYXllck1vZGUgPSB0aGlzLl9yZW5kZXJUZXh0XG4gICAgICAgICAgPyB0aGlzLl9yZW5kZXJUZXh0TW9kZVxuICAgICAgICAgIDogUmVuZGVyVGV4dE1vZGUuRElTQUJMRUQ7XG4gICAgICAgIHRoaXMucmVzZXRQZGZEb2N1bWVudCgpO1xuICAgICAgfSBlbHNlIGlmICgnc2hvd0FsbCcgaW4gY2hhbmdlcykge1xuICAgICAgICB0aGlzLnJlc2V0UGRmRG9jdW1lbnQoKTtcbiAgICAgIH1cbiAgICAgIGlmICgncGFnZScgaW4gY2hhbmdlcykge1xuICAgICAgICBjb25zdCB7IHBhZ2UgfSA9IGNoYW5nZXM7XG4gICAgICAgIGlmIChwYWdlLmN1cnJlbnRWYWx1ZSA9PT0gdGhpcy5fbGF0ZXN0U2Nyb2xsZWRQYWdlKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gTmV3IGZvcm0gb2YgcGFnZSBjaGFuZ2luZzogVGhlIHZpZXdlciB3aWxsIG5vdyBqdW1wIHRvIHRoZSBzcGVjaWZpZWQgcGFnZSB3aGVuIGl0IGlzIGNoYW5nZWQuXG4gICAgICAgIC8vIFRoaXMgYmVoYXZpb3IgaXMgaW50cm9kdWNlZCBieSB1c2luZyB0aGUgUERGU2luZ2xlUGFnZVZpZXdlclxuICAgICAgICB0aGlzLmdldEN1cnJlbnRWaWV3ZXIoKS5zY3JvbGxQYWdlSW50b1ZpZXcoeyBwYWdlTnVtYmVyOiB0aGlzLl9wYWdlIH0pO1xuICAgICAgfVxuXG4gICAgICB0aGlzLnVwZGF0ZSgpO1xuICAgIH1cbiAgfVxuXG4gIHB1YmxpYyB1cGRhdGVTaXplKCkge1xuICAgIGNvbnN0IGN1cnJlbnRWaWV3ZXIgPSB0aGlzLmdldEN1cnJlbnRWaWV3ZXIoKTtcblxuICAgIGZyb20oXG4gICAgICAodGhpcy5fcGRmLmdldFBhZ2UoXG4gICAgICAgIGN1cnJlbnRWaWV3ZXIuY3VycmVudFBhZ2VOdW1iZXJcbiAgICAgICkgYXMgdW5rbm93bikgYXMgUHJvbWlzZTxQREZQYWdlUHJveHk+XG4gICAgKVxuICAgICAgLnBpcGUodGFrZVVudGlsKHRoaXMuZGVzdHJveSQpKVxuICAgICAgLnN1YnNjcmliZSh7XG4gICAgICAgIG5leHQ6IChwYWdlOiBQREZQYWdlUHJveHkpID0+IHtcbiAgICAgICAgICBjb25zdCByb3RhdGlvbiA9IHRoaXMuX3JvdGF0aW9uIHx8IHBhZ2Uucm90YXRlO1xuICAgICAgICAgIGNvbnN0IHZpZXdwb3J0V2lkdGggPVxuICAgICAgICAgICAgKHBhZ2UgYXMgYW55KS5nZXRWaWV3cG9ydCh7XG4gICAgICAgICAgICAgIHNjYWxlOiB0aGlzLl96b29tLFxuICAgICAgICAgICAgICByb3RhdGlvblxuICAgICAgICAgICAgfSkud2lkdGggKiBQZGZWaWV3ZXJDb21wb25lbnQuQ1NTX1VOSVRTO1xuICAgICAgICAgIGxldCBzY2FsZSA9IHRoaXMuX3pvb207XG4gICAgICAgICAgbGV0IHN0aWNrVG9QYWdlID0gdHJ1ZTtcblxuICAgICAgICAgIC8vIFNjYWxlIHRoZSBkb2N1bWVudCB3aGVuIGl0IHNob3VsZG4ndCBiZSBpbiBvcmlnaW5hbCBzaXplIG9yIGRvZXNuJ3QgZml0IGludG8gdGhlIHZpZXdwb3J0XG4gICAgICAgICAgaWYgKFxuICAgICAgICAgICAgIXRoaXMuX29yaWdpbmFsU2l6ZSB8fFxuICAgICAgICAgICAgKHRoaXMuX2ZpdFRvUGFnZSAmJlxuICAgICAgICAgICAgICB2aWV3cG9ydFdpZHRoID4gdGhpcy5wZGZWaWV3ZXJDb250YWluZXIubmF0aXZlRWxlbWVudC5jbGllbnRXaWR0aClcbiAgICAgICAgICApIHtcbiAgICAgICAgICAgIGNvbnN0IHZpZXdQb3J0ID0gKHBhZ2UgYXMgYW55KS5nZXRWaWV3cG9ydCh7IHNjYWxlOiAxLCByb3RhdGlvbiB9KTtcbiAgICAgICAgICAgIHNjYWxlID0gdGhpcy5nZXRTY2FsZSh2aWV3UG9ydC53aWR0aCwgdmlld1BvcnQuaGVpZ2h0KTtcbiAgICAgICAgICAgIHN0aWNrVG9QYWdlID0gIXRoaXMuX3N0aWNrVG9QYWdlO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGN1cnJlbnRWaWV3ZXIuX3NldFNjYWxlKHNjYWxlLCBzdGlja1RvUGFnZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgcHVibGljIGNsZWFyKCkge1xuICAgIGlmICh0aGlzLmxvYWRpbmdUYXNrICYmICF0aGlzLmxvYWRpbmdUYXNrLmRlc3Ryb3llZCkge1xuICAgICAgdGhpcy5sb2FkaW5nVGFzay5kZXN0cm95KCk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuX3BkZikge1xuICAgICAgdGhpcy5fcGRmLmRlc3Ryb3koKTtcbiAgICAgIHRoaXMuX3BkZiA9IG51bGw7XG4gICAgICB0aGlzLnBkZk11bHRpUGFnZVZpZXdlci5zZXREb2N1bWVudChudWxsKTtcbiAgICAgIHRoaXMucGRmU2luZ2xlUGFnZVZpZXdlci5zZXREb2N1bWVudChudWxsKTtcblxuICAgICAgdGhpcy5wZGZNdWx0aVBhZ2VMaW5rU2VydmljZS5zZXREb2N1bWVudChudWxsLCBudWxsKTtcbiAgICAgIHRoaXMucGRmU2luZ2xlUGFnZUxpbmtTZXJ2aWNlLnNldERvY3VtZW50KG51bGwsIG51bGwpO1xuXG4gICAgICB0aGlzLnBkZk11bHRpUGFnZUZpbmRDb250cm9sbGVyLnNldERvY3VtZW50KG51bGwpO1xuICAgICAgdGhpcy5wZGZTaW5nbGVQYWdlRmluZENvbnRyb2xsZXIuc2V0RG9jdW1lbnQobnVsbCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBnZXRQREZMaW5rU2VydmljZUNvbmZpZygpIHtcbiAgICBjb25zdCBwZGZMaW5rU2VydmljZUNvbmZpZzogYW55ID0ge307XG4gICAgY29uc3QgbGlua1RhcmdldCA9IFBkZlZpZXdlckNvbXBvbmVudC5nZXRMaW5rVGFyZ2V0KHRoaXMuX2V4dGVybmFsTGlua1RhcmdldCk7XG5cbiAgICBpZiAobGlua1RhcmdldCkge1xuICAgICAgcGRmTGlua1NlcnZpY2VDb25maWcuZXh0ZXJuYWxMaW5rVGFyZ2V0ID0gbGlua1RhcmdldDtcbiAgICB9XG5cbiAgICByZXR1cm4gcGRmTGlua1NlcnZpY2VDb25maWc7XG4gIH1cblxuICBwcml2YXRlIHNldHVwTXVsdGlQYWdlVmlld2VyKCkge1xuICAgIGFzc2lnbihQREZKUywgJ2Rpc2FibGVUZXh0TGF5ZXInLCAhdGhpcy5fcmVuZGVyVGV4dCk7XG5cbiAgICBjb25zdCBldmVudEJ1cyA9IGNyZWF0ZUV2ZW50QnVzKFBERkpTVmlld2VyLCB0aGlzLmRlc3Ryb3kkKTtcblxuICAgIGZyb21FdmVudDxDdXN0b21FdmVudD4oZXZlbnRCdXMsICdwYWdlcmVuZGVyZWQnKVxuICAgICAgLnBpcGUodGFrZVVudGlsKHRoaXMuZGVzdHJveSQpKVxuICAgICAgLnN1YnNjcmliZSgoZXZlbnQpID0+IHtcbiAgICAgICAgdGhpcy5wYWdlUmVuZGVyZWQuZW1pdChldmVudCk7XG4gICAgICB9KTtcblxuICAgIGZyb21FdmVudDxDdXN0b21FdmVudD4oZXZlbnRCdXMsICdwYWdlc2luaXQnKVxuICAgICAgLnBpcGUodGFrZVVudGlsKHRoaXMuZGVzdHJveSQpKVxuICAgICAgLnN1YnNjcmliZSgoZXZlbnQpID0+IHtcbiAgICAgICAgdGhpcy5wYWdlSW5pdGlhbGl6ZWQuZW1pdChldmVudCk7XG4gICAgICB9KTtcblxuICAgIGZyb21FdmVudChldmVudEJ1cywgJ3BhZ2VjaGFuZ2luZycpXG4gICAgICAucGlwZSh0YWtlVW50aWwodGhpcy5kZXN0cm95JCkpXG4gICAgICAuc3Vic2NyaWJlKCh7IHBhZ2VOdW1iZXIgfSkgPT4ge1xuICAgICAgICBpZiAodGhpcy5wYWdlU2Nyb2xsVGltZW91dCkge1xuICAgICAgICAgIGNsZWFyVGltZW91dCh0aGlzLnBhZ2VTY3JvbGxUaW1lb3V0KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHRoaXMucGFnZVNjcm9sbFRpbWVvdXQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgdGhpcy5fbGF0ZXN0U2Nyb2xsZWRQYWdlID0gcGFnZU51bWJlcjtcbiAgICAgICAgICB0aGlzLnBhZ2VDaGFuZ2UuZW1pdChwYWdlTnVtYmVyKTtcbiAgICAgICAgfSwgMTAwKTtcbiAgICAgIH0pO1xuXG4gICAgZnJvbUV2ZW50PEN1c3RvbUV2ZW50PihldmVudEJ1cywgJ3RleHRsYXllcnJlbmRlcmVkJylcbiAgICAgIC5waXBlKHRha2VVbnRpbCh0aGlzLmRlc3Ryb3kkKSlcbiAgICAgIC5zdWJzY3JpYmUoKGV2ZW50KSA9PiB7XG4gICAgICAgIHRoaXMudGV4dExheWVyUmVuZGVyZWQuZW1pdChldmVudCk7XG4gICAgICB9KTtcblxuICAgIHRoaXMucGRmTXVsdGlQYWdlTGlua1NlcnZpY2UgPSBuZXcgUERGSlNWaWV3ZXIuUERGTGlua1NlcnZpY2Uoe1xuICAgICAgZXZlbnRCdXMsIC4uLnRoaXMuZ2V0UERGTGlua1NlcnZpY2VDb25maWcoKVxuICAgIH0pO1xuICAgIHRoaXMucGRmTXVsdGlQYWdlRmluZENvbnRyb2xsZXIgPSBuZXcgUERGSlNWaWV3ZXIuUERGRmluZENvbnRyb2xsZXIoe1xuICAgICAgbGlua1NlcnZpY2U6IHRoaXMucGRmTXVsdGlQYWdlTGlua1NlcnZpY2UsXG4gICAgICBldmVudEJ1c1xuICAgIH0pO1xuXG4gICAgY29uc3QgcGRmT3B0aW9uczogUERGVmlld2VyT3B0aW9ucyA9IHtcbiAgICAgIGV2ZW50QnVzLFxuICAgICAgY29udGFpbmVyOiB0aGlzLmVsZW1lbnQubmF0aXZlRWxlbWVudC5xdWVyeVNlbGVjdG9yKCdkaXYnKSxcbiAgICAgIHJlbW92ZVBhZ2VCb3JkZXJzOiAhdGhpcy5fc2hvd0JvcmRlcnMsXG4gICAgICBsaW5rU2VydmljZTogdGhpcy5wZGZNdWx0aVBhZ2VMaW5rU2VydmljZSxcbiAgICAgIHRleHRMYXllck1vZGU6IHRoaXMuX3JlbmRlclRleHRcbiAgICAgICAgPyB0aGlzLl9yZW5kZXJUZXh0TW9kZVxuICAgICAgICA6IFJlbmRlclRleHRNb2RlLkRJU0FCTEVELFxuICAgICAgZmluZENvbnRyb2xsZXI6IHRoaXMucGRmTXVsdGlQYWdlRmluZENvbnRyb2xsZXIsXG4gICAgICByZW5kZXJlcjogJ2NhbnZhcycsXG4gICAgICBsMTBuOiB1bmRlZmluZWRcbiAgICB9O1xuXG4gICAgdGhpcy5wZGZNdWx0aVBhZ2VWaWV3ZXIgPSBuZXcgUERGSlNWaWV3ZXIuUERGVmlld2VyKHBkZk9wdGlvbnMpO1xuICAgIHRoaXMucGRmTXVsdGlQYWdlTGlua1NlcnZpY2Uuc2V0Vmlld2VyKHRoaXMucGRmTXVsdGlQYWdlVmlld2VyKTtcbiAgICB0aGlzLnBkZk11bHRpUGFnZUZpbmRDb250cm9sbGVyLnNldERvY3VtZW50KHRoaXMuX3BkZik7XG4gIH1cblxuICBwcml2YXRlIHNldHVwU2luZ2xlUGFnZVZpZXdlcigpIHtcbiAgICBhc3NpZ24oUERGSlMsICdkaXNhYmxlVGV4dExheWVyJywgIXRoaXMuX3JlbmRlclRleHQpO1xuXG4gICAgY29uc3QgZXZlbnRCdXMgPSBjcmVhdGVFdmVudEJ1cyhQREZKU1ZpZXdlciwgdGhpcy5kZXN0cm95JCk7XG5cbiAgICBmcm9tRXZlbnQoZXZlbnRCdXMsICdwYWdlY2hhbmdpbmcnKVxuICAgICAgLnBpcGUodGFrZVVudGlsKHRoaXMuZGVzdHJveSQpKVxuICAgICAgLnN1YnNjcmliZSgoeyBwYWdlTnVtYmVyIH0pID0+IHtcbiAgICAgICAgaWYgKHBhZ2VOdW1iZXIgIT09IHRoaXMuX3BhZ2UpIHtcbiAgICAgICAgICB0aGlzLnBhZ2UgPSBwYWdlTnVtYmVyO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgIGZyb21FdmVudDxDdXN0b21FdmVudD4oZXZlbnRCdXMsICdwYWdlcmVuZGVyZWQnKVxuICAgICAgLnBpcGUodGFrZVVudGlsKHRoaXMuZGVzdHJveSQpKVxuICAgICAgLnN1YnNjcmliZSgoZXZlbnQpID0+IHtcbiAgICAgICAgdGhpcy5wYWdlUmVuZGVyZWQuZW1pdChldmVudCk7XG4gICAgICB9KTtcblxuICAgIGZyb21FdmVudDxDdXN0b21FdmVudD4oZXZlbnRCdXMsICdwYWdlc2luaXQnKVxuICAgICAgLnBpcGUodGFrZVVudGlsKHRoaXMuZGVzdHJveSQpKVxuICAgICAgLnN1YnNjcmliZSgoZXZlbnQpID0+IHtcbiAgICAgICAgdGhpcy5wYWdlSW5pdGlhbGl6ZWQuZW1pdChldmVudCk7XG4gICAgICB9KTtcblxuICAgIGZyb21FdmVudDxDdXN0b21FdmVudD4oZXZlbnRCdXMsICd0ZXh0bGF5ZXJyZW5kZXJlZCcpXG4gICAgICAucGlwZSh0YWtlVW50aWwodGhpcy5kZXN0cm95JCkpXG4gICAgICAuc3Vic2NyaWJlKChldmVudCkgPT4ge1xuICAgICAgICB0aGlzLnRleHRMYXllclJlbmRlcmVkLmVtaXQoZXZlbnQpO1xuICAgICAgfSk7XG5cbiAgICB0aGlzLnBkZlNpbmdsZVBhZ2VMaW5rU2VydmljZSA9IG5ldyBQREZKU1ZpZXdlci5QREZMaW5rU2VydmljZSh7XG4gICAgICBldmVudEJ1cywgLi4udGhpcy5nZXRQREZMaW5rU2VydmljZUNvbmZpZygpXG4gICAgfSk7XG4gICAgdGhpcy5wZGZTaW5nbGVQYWdlRmluZENvbnRyb2xsZXIgPSBuZXcgUERGSlNWaWV3ZXIuUERGRmluZENvbnRyb2xsZXIoe1xuICAgICAgbGlua1NlcnZpY2U6IHRoaXMucGRmU2luZ2xlUGFnZUxpbmtTZXJ2aWNlLFxuICAgICAgZXZlbnRCdXNcbiAgICB9KTtcblxuICAgIGNvbnN0IHBkZk9wdGlvbnMgPSB7XG4gICAgICBldmVudEJ1cyxcbiAgICAgIGNvbnRhaW5lcjogdGhpcy5lbGVtZW50Lm5hdGl2ZUVsZW1lbnQucXVlcnlTZWxlY3RvcignZGl2JyksXG4gICAgICByZW1vdmVQYWdlQm9yZGVyczogIXRoaXMuX3Nob3dCb3JkZXJzLFxuICAgICAgbGlua1NlcnZpY2U6IHRoaXMucGRmU2luZ2xlUGFnZUxpbmtTZXJ2aWNlLFxuICAgICAgdGV4dExheWVyTW9kZTogdGhpcy5fcmVuZGVyVGV4dFxuICAgICAgICA/IHRoaXMuX3JlbmRlclRleHRNb2RlXG4gICAgICAgIDogUmVuZGVyVGV4dE1vZGUuRElTQUJMRUQsXG4gICAgICBmaW5kQ29udHJvbGxlcjogdGhpcy5wZGZTaW5nbGVQYWdlRmluZENvbnRyb2xsZXJcbiAgICB9O1xuXG4gICAgdGhpcy5wZGZTaW5nbGVQYWdlVmlld2VyID0gbmV3IFBERkpTVmlld2VyLlBERlNpbmdsZVBhZ2VWaWV3ZXIocGRmT3B0aW9ucyk7XG4gICAgdGhpcy5wZGZTaW5nbGVQYWdlTGlua1NlcnZpY2Uuc2V0Vmlld2VyKHRoaXMucGRmU2luZ2xlUGFnZVZpZXdlcik7XG4gICAgdGhpcy5wZGZTaW5nbGVQYWdlRmluZENvbnRyb2xsZXIuc2V0RG9jdW1lbnQodGhpcy5fcGRmKTtcblxuICAgIHRoaXMucGRmU2luZ2xlUGFnZVZpZXdlci5fY3VycmVudFBhZ2VOdW1iZXIgPSB0aGlzLl9wYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRWYWxpZFBhZ2VOdW1iZXIocGFnZTogbnVtYmVyKTogbnVtYmVyIHtcbiAgICBpZiAocGFnZSA8IDEpIHtcbiAgICAgIHJldHVybiAxO1xuICAgIH1cblxuICAgIGlmIChwYWdlID4gdGhpcy5fcGRmLm51bVBhZ2VzKSB7XG4gICAgICByZXR1cm4gdGhpcy5fcGRmLm51bVBhZ2VzO1xuICAgIH1cblxuICAgIHJldHVybiBwYWdlO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXREb2N1bWVudFBhcmFtcygpIHtcbiAgICBjb25zdCBzcmNUeXBlID0gdHlwZW9mIHRoaXMuc3JjO1xuXG4gICAgaWYgKCF0aGlzLl9jTWFwc1VybCkge1xuICAgICAgcmV0dXJuIHRoaXMuc3JjO1xuICAgIH1cblxuICAgIGNvbnN0IHBhcmFtczogYW55ID0ge1xuICAgICAgY01hcFVybDogdGhpcy5fY01hcHNVcmwsXG4gICAgICBjTWFwUGFja2VkOiB0cnVlXG4gICAgfTtcblxuICAgIGlmIChzcmNUeXBlID09PSAnc3RyaW5nJykge1xuICAgICAgcGFyYW1zLnVybCA9IHRoaXMuc3JjO1xuICAgIH0gZWxzZSBpZiAoc3JjVHlwZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICgodGhpcy5zcmMgYXMgYW55KS5ieXRlTGVuZ3RoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgcGFyYW1zLmRhdGEgPSB0aGlzLnNyYztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIE9iamVjdC5hc3NpZ24ocGFyYW1zLCB0aGlzLnNyYyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHBhcmFtcztcbiAgfVxuXG4gIHByaXZhdGUgbG9hZFBERigpIHtcbiAgICBpZiAoIXRoaXMuc3JjKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMubGFzdExvYWRlZCA9PT0gdGhpcy5zcmMpIHtcbiAgICAgIHRoaXMudXBkYXRlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5jbGVhcigpO1xuXG4gICAgdGhpcy5sb2FkaW5nVGFzayA9IFBERkpTLmdldERvY3VtZW50KHRoaXMuZ2V0RG9jdW1lbnRQYXJhbXMoKSk7XG5cbiAgICB0aGlzLmxvYWRpbmdUYXNrLm9uUHJvZ3Jlc3MgPSAocHJvZ3Jlc3NEYXRhOiBQREZQcm9ncmVzc0RhdGEpID0+IHtcbiAgICAgIHRoaXMub25Qcm9ncmVzcy5lbWl0KHByb2dyZXNzRGF0YSk7XG4gICAgfTtcblxuICAgIGNvbnN0IHNyYyA9IHRoaXMuc3JjO1xuXG4gICAgZnJvbSh0aGlzLmxvYWRpbmdUYXNrLnByb21pc2UgYXMgUHJvbWlzZTxQREZEb2N1bWVudFByb3h5PilcbiAgICAgIC5waXBlKHRha2VVbnRpbCh0aGlzLmRlc3Ryb3kkKSlcbiAgICAgIC5zdWJzY3JpYmUoe1xuICAgICAgICBuZXh0OiAocGRmKSA9PiB7XG4gICAgICAgICAgdGhpcy5fcGRmID0gcGRmO1xuICAgICAgICAgIHRoaXMubGFzdExvYWRlZCA9IHNyYztcblxuICAgICAgICAgIHRoaXMuYWZ0ZXJMb2FkQ29tcGxldGUuZW1pdChwZGYpO1xuXG4gICAgICAgICAgaWYgKCF0aGlzLnBkZk11bHRpUGFnZVZpZXdlcikge1xuICAgICAgICAgICAgdGhpcy5zZXR1cE11bHRpUGFnZVZpZXdlcigpO1xuICAgICAgICAgICAgdGhpcy5zZXR1cFNpbmdsZVBhZ2VWaWV3ZXIoKTtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICB0aGlzLnJlc2V0UGRmRG9jdW1lbnQoKTtcblxuICAgICAgICAgIHRoaXMudXBkYXRlKCk7XG4gICAgICAgIH0sXG4gICAgICAgIGVycm9yOiAoZXJyb3IpID0+IHtcbiAgICAgICAgICB0aGlzLm9uRXJyb3IuZW1pdChlcnJvcik7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGUoKSB7XG4gICAgdGhpcy5wYWdlID0gdGhpcy5fcGFnZTtcblxuICAgIHRoaXMucmVuZGVyKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlcigpIHtcbiAgICB0aGlzLl9wYWdlID0gdGhpcy5nZXRWYWxpZFBhZ2VOdW1iZXIodGhpcy5fcGFnZSk7XG4gICAgY29uc3QgY3VycmVudFZpZXdlciA9IHRoaXMuZ2V0Q3VycmVudFZpZXdlcigpO1xuXG4gICAgaWYgKFxuICAgICAgdGhpcy5fcm90YXRpb24gIT09IDAgfHxcbiAgICAgIGN1cnJlbnRWaWV3ZXIucGFnZXNSb3RhdGlvbiAhPT0gdGhpcy5fcm90YXRpb25cbiAgICApIHtcbiAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgICBjdXJyZW50Vmlld2VyLnBhZ2VzUm90YXRpb24gPSB0aGlzLl9yb3RhdGlvbjtcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLl9zdGlja1RvUGFnZSkge1xuICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGN1cnJlbnRWaWV3ZXIuY3VycmVudFBhZ2VOdW1iZXIgPSB0aGlzLl9wYWdlO1xuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy51cGRhdGVTaXplKCk7XG4gIH1cblxuICBwcml2YXRlIGdldFNjYWxlKHZpZXdwb3J0V2lkdGg6IG51bWJlciwgdmlld3BvcnRIZWlnaHQ6IG51bWJlcikge1xuICAgIGNvbnN0IGJvcmRlclNpemUgPSAodGhpcy5fc2hvd0JvcmRlcnMgPyAyICogUGRmVmlld2VyQ29tcG9uZW50LkJPUkRFUl9XSURUSCA6IDApO1xuICAgIGNvbnN0IHBkZkNvbnRhaW5lcldpZHRoID0gdGhpcy5wZGZWaWV3ZXJDb250YWluZXIubmF0aXZlRWxlbWVudC5jbGllbnRXaWR0aCAtIGJvcmRlclNpemU7XG4gICAgY29uc3QgcGRmQ29udGFpbmVySGVpZ2h0ID0gdGhpcy5wZGZWaWV3ZXJDb250YWluZXIubmF0aXZlRWxlbWVudC5jbGllbnRIZWlnaHQgLSBib3JkZXJTaXplO1xuXG4gICAgaWYgKHBkZkNvbnRhaW5lckhlaWdodCA9PT0gMCB8fCB2aWV3cG9ydEhlaWdodCA9PT0gMCB8fCBwZGZDb250YWluZXJXaWR0aCA9PT0gMCB8fCB2aWV3cG9ydFdpZHRoID09PSAwKSB7XG4gICAgICByZXR1cm4gMTtcbiAgICB9XG5cbiAgICBsZXQgcmF0aW8gPSAxO1xuICAgIHN3aXRjaCAodGhpcy5fem9vbVNjYWxlKSB7XG4gICAgICBjYXNlICdwYWdlLWZpdCc6XG4gICAgICAgIHJhdGlvID0gTWF0aC5taW4oKHBkZkNvbnRhaW5lckhlaWdodCAvIHZpZXdwb3J0SGVpZ2h0KSwgKHBkZkNvbnRhaW5lcldpZHRoIC8gdmlld3BvcnRXaWR0aCkpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3BhZ2UtaGVpZ2h0JzpcbiAgICAgICAgcmF0aW8gPSAocGRmQ29udGFpbmVySGVpZ2h0IC8gdmlld3BvcnRIZWlnaHQpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgJ3BhZ2Utd2lkdGgnOlxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmF0aW8gPSAocGRmQ29udGFpbmVyV2lkdGggLyB2aWV3cG9ydFdpZHRoKTtcbiAgICAgICAgYnJlYWs7XG4gICAgfVxuXG4gICAgcmV0dXJuICh0aGlzLl96b29tICogcmF0aW8pIC8gUGRmVmlld2VyQ29tcG9uZW50LkNTU19VTklUUztcbiAgfVxuXG4gIHByaXZhdGUgZ2V0Q3VycmVudFZpZXdlcigpOiBhbnkge1xuICAgIHJldHVybiB0aGlzLl9zaG93QWxsID8gdGhpcy5wZGZNdWx0aVBhZ2VWaWV3ZXIgOiB0aGlzLnBkZlNpbmdsZVBhZ2VWaWV3ZXI7XG4gIH1cblxuICBwcml2YXRlIHJlc2V0UGRmRG9jdW1lbnQoKSB7XG4gICAgdGhpcy5wZGZGaW5kQ29udHJvbGxlci5zZXREb2N1bWVudCh0aGlzLl9wZGYpO1xuXG4gICAgaWYgKHRoaXMuX3Nob3dBbGwpIHtcbiAgICAgIHRoaXMucGRmU2luZ2xlUGFnZVZpZXdlci5zZXREb2N1bWVudChudWxsKTtcbiAgICAgIHRoaXMucGRmU2luZ2xlUGFnZUxpbmtTZXJ2aWNlLnNldERvY3VtZW50KG51bGwpO1xuXG4gICAgICB0aGlzLnBkZk11bHRpUGFnZVZpZXdlci5zZXREb2N1bWVudCh0aGlzLl9wZGYpO1xuICAgICAgdGhpcy5wZGZNdWx0aVBhZ2VMaW5rU2VydmljZS5zZXREb2N1bWVudCh0aGlzLl9wZGYsIG51bGwpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnBkZk11bHRpUGFnZVZpZXdlci5zZXREb2N1bWVudChudWxsKTtcbiAgICAgIHRoaXMucGRmTXVsdGlQYWdlTGlua1NlcnZpY2Uuc2V0RG9jdW1lbnQobnVsbCk7XG5cbiAgICAgIHRoaXMucGRmU2luZ2xlUGFnZVZpZXdlci5zZXREb2N1bWVudCh0aGlzLl9wZGYpO1xuICAgICAgdGhpcy5wZGZTaW5nbGVQYWdlTGlua1NlcnZpY2Uuc2V0RG9jdW1lbnQodGhpcy5fcGRmLCBudWxsKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGluaXRpYWxpemUoKTogdm9pZCB7XG4gICAgaWYgKGlzU1NSKCkgfHwgIXRoaXMuaXNWaXNpYmxlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5pc0luaXRpYWxpemVkID0gdHJ1ZTtcbiAgICB0aGlzLnNldHVwTXVsdGlQYWdlVmlld2VyKCk7XG4gICAgdGhpcy5zZXR1cFNpbmdsZVBhZ2VWaWV3ZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBSZXNpemVMaXN0ZW5lcigpOiB2b2lkIHtcbiAgICBpZiAoaXNTU1IoKSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMubmdab25lLnJ1bk91dHNpZGVBbmd1bGFyKCgpID0+IHtcbiAgICAgIGZyb21FdmVudCh3aW5kb3csICdyZXNpemUnKVxuICAgICAgICAucGlwZShcbiAgICAgICAgICBkZWJvdW5jZVRpbWUoMTAwKSxcbiAgICAgICAgICBmaWx0ZXIoKCkgPT4gdGhpcy5fY2FuQXV0b1Jlc2l6ZSAmJiAhIXRoaXMuX3BkZiksXG4gICAgICAgICAgdGFrZVVudGlsKHRoaXMuZGVzdHJveSQpXG4gICAgICAgIClcbiAgICAgICAgLnN1YnNjcmliZSgoKSA9PiB7XG4gICAgICAgICAgdGhpcy51cGRhdGVTaXplKCk7XG4gICAgICAgIH0pO1xuICAgIH0pO1xuICB9XG59XG4iXX0=