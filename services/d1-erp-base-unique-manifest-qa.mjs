// Source pinned to ERP `server.js` blob acdc24e8d829dfd2f43fdecfc6b9f06aa67fed23.
// 56 source UNIQUE (table-level and inline) + 8 composite and 2 TEXT PRIMARY KEY constraints.
// This is a metadata-only D1 schema audit contract; not migration approval.
export const ERP_D1_BASE_UNIQUE_KEYS=Object.freeze({
 "attendance_records": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "employee_id",
    "attendance_date"
   ]
  }
 ],
 "audit_logs": [],
 "bottle_movements": [],
 "bottles": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "code"
   ]
  }
 ],
 "certificates": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "certificate_number"
   ]
  }
 ],
 "commission_lines": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "statement_id",
    "sale_id",
    "delivery_id"
   ]
  }
 ],
 "commission_rules": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "name"
   ]
  }
 ],
 "commission_settlements": [],
 "commission_statements": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "beneficiary_id",
    "period_start",
    "period_end"
   ]
  }
 ],
 "companies": [],
 "company_currency_settings": [],
 "company_features": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "feature_id"
   ]
  }
 ],
 "complaints": [],
 "credit_blocks": [],
 "credit_ledger": [],
 "credit_policies": [
  {
   "origin": "u",
   "columns": [
    "company_id"
   ]
  }
 ],
 "customer_credit_accounts": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "customer_id"
   ]
  }
 ],
 "customer_price_lists": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "customer_id"
   ]
  }
 ],
 "customer_service_areas": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "customer_id"
   ]
  }
 ],
 "customers": [],
 "deliveries": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "order_id"
   ]
  }
 ],
 "delivery_bottle_counts": [],
 "delivery_otp_challenges": [],
 "delivery_proofs": [
  {
   "origin": "u",
   "columns": [
    "delivery_id"
   ]
  }
 ],
 "delivery_route_stops": [
  {
   "origin": "u",
   "columns": [
    "route_id",
    "sequence"
   ]
  }
 ],
 "delivery_routes": [],
 "delivery_subscription_occurrences": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "delivery_subscription_id",
    "due_date"
   ]
  }
 ],
 "delivery_subscriptions": [],
 "discount_approvals": [],
 "document_access": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "document_id",
    "role"
   ]
  }
 ],
 "document_records": [],
 "document_reminders": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "document_id"
   ]
  }
 ],
 "document_versions": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "document_id",
    "version_number"
   ]
  },
  {
   "origin": "u",
   "columns": [
    "company_id",
    "storage_key"
   ]
  }
 ],
 "employees": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "employee_id"
   ]
  }
 ],
 "equipment_assets": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "asset_tag"
   ]
  }
 ],
 "error_events": [],
 "exchange_rates": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "base_currency",
    "quote_currency",
    "effective_at"
   ]
  }
 ],
 "expenses": [],
 "features": [
  {
   "origin": "u",
   "columns": [
    "feature_key"
   ]
  }
 ],
 "fleet_assignments": [],
 "fleet_documents": [],
 "lab_parameters": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "name"
   ]
  }
 ],
 "lab_test_results": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "test_id",
    "parameter_id"
   ]
  }
 ],
 "lab_tests": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "test_number"
   ]
  }
 ],
 "loyalty_accounts": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "customer_id"
   ]
  }
 ],
 "loyalty_tiers": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "name"
   ]
  }
 ],
 "loyalty_transactions": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "idempotency_key"
   ]
  }
 ],
 "notification_deliveries": [],
 "notification_preferences": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "user_id",
    "notification_type"
   ]
  }
 ],
 "notification_templates": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "notification_type",
    "name"
   ]
  }
 ],
 "notifications": [],
 "offline_sync_operations": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "driver_id",
    "idempotency_key"
   ]
  }
 ],
 "order_items": [],
 "orders": [],
 "password_reset_tokens": [
  {
   "origin": "pk",
   "columns": ["token"]
  }
 ],
 "payments": [],
 "payroll_runs": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "period_start",
    "period_end"
   ]
  }
 ],
 "payslips": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "payroll_run_id",
    "employee_id"
   ]
  }
 ],
 "plan_features": [
  {
   "origin": "u",
   "columns": [
    "plan_id",
    "feature_id"
   ]
  }
 ],
 "plans": [
  {
   "origin": "u",
   "columns": [
    "slug"
   ]
  }
 ],
 "price_list_items": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "price_list_id",
    "product_id",
    "min_quantity"
   ]
  }
 ],
 "price_lists": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "name"
   ]
  }
 ],
 "production_batch_inputs": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "batch_id",
    "product_id"
   ]
  }
 ],
 "production_batches": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "batch_number"
   ]
  }
 ],
 "production_lines": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "code"
   ]
  }
 ],
 "products": [],
 "purchase_items": [],
 "purchase_order_items": [],
 "purchase_orders": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "po_number"
   ]
  }
 ],
 "purchases": [],
 "qr_lookup_history": [],
 "qr_records": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "entity_type",
    "entity_id"
   ]
  },
  {
   "origin": "u",
   "columns": [
    "qr_key"
   ]
  }
 ],
 "quality_certificates": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "certificate_number"
   ]
  },
  {
   "origin": "u",
   "columns": [
    "company_id",
    "traceability_code"
   ]
  }
 ],
 "quotation_comparison_items": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "comparison_id",
    "quotation_id"
   ]
  }
 ],
 "quotation_comparisons": [],
 "referral_codes": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "code"
   ]
  },
  {
   "origin": "u",
   "columns": [
    "company_id",
    "customer_id"
   ]
  }
 ],
 "referrals": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "referred_customer_id"
   ]
  }
 ],
 "reorder_reminders": [],
 "reorder_rules": [
  {
   "origin": "u",
   "columns": [
    "company_id"
   ]
  }
 ],
 "report_definitions": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "name"
   ]
  }
 ],
 "sale_items": [],
 "sales": [],
 "salesman_activities": [],
 "salesman_assignments": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "customer_id"
   ]
  }
 ],
 "schema_migrations": [],
 "service_area_drivers": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "service_area_id",
    "driver_id"
   ]
  }
 ],
 "service_areas": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "parent_id",
    "level",
    "name"
   ]
  }
 ],
 "sessions": [
  {
   "origin": "pk",
   "columns": ["token"]
  }
 ],
 "stock_movements": [],
 "subscription_history": [],
 "subscription_payment_proofs": [
  {
   "origin": "u",
   "columns": [
    "storage_name"
   ]
  }
 ],
 "subscription_payments": [],
 "subscription_reminders": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "subscription_id",
    "reminder_type",
    "reminder_date"
   ]
  }
 ],
 "subscription_renewal_requests": [],
 "subscriptions": [],
 "supplier_categories": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "name"
   ]
  }
 ],
 "supplier_category_assignments": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "supplier_id",
    "category_id"
   ]
  }
 ],
 "supplier_contacts": [],
 "supplier_contracts": [],
 "supplier_invoice_items": [],
 "supplier_invoices": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "supplier_id",
    "invoice_number"
   ]
  }
 ],
 "supplier_payments": [],
 "supplier_products": [],
 "supplier_quotation_items": [],
 "supplier_quotations": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "quotation_number"
   ]
  }
 ],
 "supplier_ratings": [],
 "suppliers": [],
 "usage_counters": [
  {
   "origin": "pk",
   "columns": [
    "company_id",
    "metric",
    "period"
   ]
  }
 ],
 "users": [
  {
   "origin": "u",
   "columns": [
    "username"
   ]
  }
 ],
 "vehicle_fuel_logs": [],
 "vehicle_service_records": [],
 "vehicle_service_schedules": [],
 "vehicles": [
  {
   "origin": "u",
   "columns": [
    "company_id",
    "vehicle_number"
   ]
  }
 ],
 "warehouses": []
});
