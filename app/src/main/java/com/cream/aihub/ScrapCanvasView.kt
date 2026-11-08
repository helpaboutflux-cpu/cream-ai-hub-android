package com.cream.aihub

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View

/**
 * 웹 화면 캡처 위에 S펜·터치로 메모를 그리는 캔버스.
 * 캡처 이미지는 배경으로만 쓰고, 필기 레이어는 따로 두어 지우개(CLEAR)가 배경을 지우지 않게 한다.
 */
class ScrapCanvasView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0
) : View(context, attrs, defStyleAttr) {

    private data class ScrapStroke(
        val path: Path,
        val color: Int,
        val width: Float,
        val eraser: Boolean
    )

    var baseBitmap: Bitmap? = null
        set(value) {
            field = value
            invalidate()
        }

    private var annotation: Bitmap? = null
    private var annotationCanvas: Canvas? = null
    private val strokes = mutableListOf<ScrapStroke>()
    private var currentPath: Path? = null
    private var currentStroke: ScrapStroke? = null

    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
    }

    var penColor: Int = Color.parseColor("#09090B")
    var penWidth: Float = 6f
    var eraserMode: Boolean = false

    private val baseRect = RectF()

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
        isClickable = true
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w <= 0 || h <= 0) return
        val fresh = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        annotation = fresh
        annotationCanvas = Canvas(fresh)
        strokes.clear()
        if (oldw > 0 && oldh > 0) invalidate()
    }

    private fun computeBaseRect() {
        val bmp = baseBitmap ?: return
        val scale = minOf(width.toFloat() / bmp.width, height.toFloat() / bmp.height)
        val dw = bmp.width * scale
        val dh = bmp.height * scale
        val left = (width - dw) / 2f
        val top = (height - dh) / 2f
        baseRect.set(left, top, left + dw, top + dh)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(Color.parseColor("#FFFFFF"))
        val bmp = baseBitmap
        if (bmp != null && !bmp.isRecycled) {
            computeBaseRect()
            canvas.drawBitmap(bmp, null, baseRect, Paint(Paint.FILTER_BITMAP_FLAG))
        }
        annotation?.let { canvas.drawBitmap(it, 0f, 0f, null) }
    }

    private fun paintFor(stroke: ScrapStroke): Paint {
        paint.color = if (stroke.eraser) Color.TRANSPARENT else stroke.color
        paint.strokeWidth = stroke.width
        paint.xfermode = if (stroke.eraser) PorterDuffXfermode(PorterDuff.Mode.CLEAR) else null
        return paint
    }

    private fun touchToPath(event: MotionEvent, path: Path, isStart: Boolean) {
        if (isStart) path.moveTo(event.x, event.y) else path.lineTo(event.x, event.y)
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        val w = width
        val h = height
        if (w <= 0 || h <= 0) return false
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                val stroke = ScrapStroke(
                    path = Path(),
                    color = penColor,
                    width = if (eraserMode) penWidth * 3.2f else penWidth,
                    eraser = eraserMode
                )
                touchToPath(event, stroke.path, true)
                currentStroke = stroke
                currentPath = stroke.path
                val p = paintFor(stroke)
                annotationCanvas?.drawPath(stroke.path, p)
                invalidate()
            }
            MotionEvent.ACTION_MOVE -> {
                val stroke = currentStroke ?: return true
                val path = currentPath ?: return true
                touchToPath(event, path, false)
                val p = paintFor(stroke)
                annotationCanvas?.drawPath(path, p)
                invalidate()
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                val stroke = currentStroke
                if (stroke != null) strokes.add(stroke)
                currentStroke = null
                currentPath = null
                invalidate()
            }
        }
        return true
    }

    fun hasDrawing(): Boolean = strokes.isNotEmpty()

    fun undo() {
        if (strokes.isEmpty()) return
        strokes.removeAt(strokes.size - 1)
        redrawAnnotation()
    }

    fun clearAll() {
        strokes.clear()
        redrawAnnotation()
    }

    private fun redrawAnnotation() {
        val canvas = annotationCanvas ?: return
        canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
        for (stroke in strokes) {
            canvas.drawPath(stroke.path, paintFor(stroke))
        }
        invalidate()
    }

    /** 배경 캡처와 필기를 합성한 결과 비트맵 (뷰 해상도). */
    fun exportBitmap(): Bitmap {
        val w = width.coerceAtLeast(1)
        val h = height.coerceAtLeast(1)
        val output = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(output)
        canvas.drawColor(Color.WHITE)
        val bmp = baseBitmap
        if (bmp != null && !bmp.isRecycled) {
            computeBaseRect()
            canvas.drawBitmap(bmp, null, baseRect, Paint(Paint.FILTER_BITMAP_FLAG))
        }
        annotation?.let { canvas.drawBitmap(it, 0f, 0f, null) }
        return output
    }
}
