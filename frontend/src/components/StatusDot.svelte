<script lang="ts">
  let { status, size = 7 }: {
    status: 'draft' | 'open' | 'approved' | 'changes-requested' |
            'review-requested' | 'merged' | 'closed' | 'unknown' |
            'in-progress' | 'code-review' | 'ready-for-qa' | 'unmapped';
    size?: number;
  } = $props();
</script>

<span
  class="status-dot status-dot--{status}"
  style:width="{size}px"
  style:height="{size}px"
  role="img"
  aria-label="{status} status"
></span>

<style>
  .status-dot {
    border-radius: 50%;
    flex-shrink: 0;
    display: inline-block;
    box-sizing: border-box;
  }
  /* PR states */
  .status-dot--draft { background: transparent; border: 1.5px solid var(--border); }
  .status-dot--open { background: var(--status-success); }
  .status-dot--approved { background: var(--status-info); }
  .status-dot--changes-requested { background: var(--status-error); }
  .status-dot--review-requested { background: var(--status-warning); }
  .status-dot--merged { background: var(--status-merged); }
  .status-dot--closed { background: var(--border); border-radius: 2px; }
  .status-dot--unknown { background: var(--border); opacity: 0.5; }
  /* Jira workflow states */
  .status-dot--in-progress { background: var(--status-info); }
  .status-dot--code-review { background: var(--status-warning); }
  .status-dot--ready-for-qa { background: var(--status-success); }
  .status-dot--unmapped { background: var(--border); opacity: 0.6; }
</style>
