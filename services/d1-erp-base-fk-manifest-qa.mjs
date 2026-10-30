// Source: c0f8690e91d0117dc8a276a0893652b0deaad251 pinned server.js 114 safe base table FOREIGN KEY declarations.
// READ-ONLY QA metadata, not a remote D1 migration or runtime schema approval.
export const ERP_D1_BASE_FOREIGN_KEYS=Object.freeze({
 "attendance_records": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "employee_id",
   "table": "employees",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "audit_logs": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "bottle_movements": [
  {
   "from": "bottle_id",
   "table": "bottles",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "bottles": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "certificates": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "document_id",
   "table": "document_records",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "commission_lines": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "statement_id",
   "table": "commission_statements",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "commission_rules": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "commission_settlements": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "settled_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "statement_id",
   "table": "commission_statements",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "commission_statements": [
  {
   "from": "beneficiary_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "companies": [],
 "company_currency_settings": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "updated_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "company_features": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "feature_id",
   "table": "features",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "complaints": [
  {
   "from": "assigned_to",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "credit_blocks": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "credit_ledger": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "payment_id",
   "table": "payments",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "sale_id",
   "table": "sales",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "credit_policies": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "updated_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "customer_credit_accounts": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "customer_price_lists": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "price_list_id",
   "table": "price_lists",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "customer_service_areas": [
  {
   "from": "assigned_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "service_area_id",
   "table": "service_areas",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "customers": [],
 "deliveries": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "driver_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "order_id",
   "table": "orders",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "delivery_bottle_counts": [
  {
   "from": "bottle_id",
   "table": "bottles",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "delivery_id",
   "table": "deliveries",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "delivery_otp_challenges": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "delivery_id",
   "table": "deliveries",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "delivery_proofs": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "delivery_id",
   "table": "deliveries",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "otp_challenge_id",
   "table": "delivery_otp_challenges",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "delivery_route_stops": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "delivery_id",
   "table": "deliveries",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "route_id",
   "table": "delivery_routes",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "delivery_routes": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "driver_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "delivery_subscription_occurrences": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "delivery_subscription_id",
   "table": "delivery_subscriptions",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "order_id",
   "table": "orders",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "delivery_subscriptions": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "discount_approvals": [
  {
   "from": "approved_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "requested_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "sale_id",
   "table": "sales",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "document_access": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "document_id",
   "table": "document_records",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "document_records": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "document_reminders": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "document_id",
   "table": "document_records",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "document_versions": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "document_id",
   "table": "document_records",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "employees": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "equipment_assets": [
  {
   "from": "assigned_employee_id",
   "table": "employees",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "error_events": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "exchange_rates": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "expenses": [],
 "features": [],
 "fleet_assignments": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "driver_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "employee_id",
   "table": "employees",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "fleet_documents": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "lab_parameters": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "lab_test_results": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "parameter_id",
   "table": "lab_parameters",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "test_id",
   "table": "lab_tests",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "lab_tests": [
  {
   "from": "batch_id",
   "table": "production_batches",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "reviewed_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "tested_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "loyalty_accounts": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "tier_id",
   "table": "loyalty_tiers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "loyalty_tiers": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "loyalty_transactions": [
  {
   "from": "account_id",
   "table": "loyalty_accounts",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "notification_deliveries": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "notification_id",
   "table": "notifications",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "notification_preferences": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "notification_templates": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "notifications": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "offline_sync_operations": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "driver_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "order_items": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "order_id",
   "table": "orders",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "orders": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "password_reset_tokens": [
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "payments": [],
 "payroll_runs": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "payslips": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "employee_id",
   "table": "employees",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "payroll_run_id",
   "table": "payroll_runs",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "plan_features": [
  {
   "from": "feature_id",
   "table": "features",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "plan_id",
   "table": "plans",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "plans": [],
 "price_list_items": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "price_list_id",
   "table": "price_lists",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "price_lists": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "production_batch_inputs": [
  {
   "from": "batch_id",
   "table": "production_batches",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "warehouse_id",
   "table": "warehouses",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "production_batches": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "line_id",
   "table": "production_lines",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "production_lines": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "products": [],
 "purchase_items": [
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "purchase_id",
   "table": "purchases",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "purchase_order_items": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "purchase_order_id",
   "table": "purchase_orders",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "supplied_product_id",
   "table": "supplier_products",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "purchase_orders": [
  {
   "from": "approved_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "quotation_id",
   "table": "supplier_quotations",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "purchases": [],
 "qr_lookup_history": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "qr_record_id",
   "table": "qr_records",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "qr_records": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "quality_certificates": [
  {
   "from": "batch_id",
   "table": "production_batches",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "issued_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "test_id",
   "table": "lab_tests",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "quotation_comparison_items": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "comparison_id",
   "table": "quotation_comparisons",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "quotation_id",
   "table": "supplier_quotations",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "quotation_comparisons": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "referral_codes": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "referrals": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "referral_code_id",
   "table": "referral_codes",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "referred_customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "referrer_customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "reorder_reminders": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "reorder_rules": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "report_definitions": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "sale_items": [
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "sale_id",
   "table": "sales",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "sales": [],
 "salesman_activities": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "order_id",
   "table": "orders",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "salesman_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "salesman_assignments": [
  {
   "from": "assigned_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "salesman_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "schema_migrations": [],
 "service_area_drivers": [
  {
   "from": "assigned_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "driver_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "service_area_id",
   "table": "service_areas",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "service_areas": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "parent_id",
   "table": "service_areas",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "sessions": [
  {
   "from": "user_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "stock_movements": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "customer_id",
   "table": "customers",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "warehouse_id",
   "table": "warehouses",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "subscription_history": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "subscription_id",
   "table": "subscriptions",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "subscription_payment_proofs": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "reviewed_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "subscription_id",
   "table": "subscriptions",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "uploaded_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "subscription_payments": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "subscription_id",
   "table": "subscriptions",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "subscription_reminders": [],
 "subscription_renewal_requests": [],
 "subscriptions": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "plan_id",
   "table": "plans",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "supplier_categories": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "supplier_category_assignments": [
  {
   "from": "assigned_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "category_id",
   "table": "supplier_categories",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "supplier_contacts": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "supplier_contracts": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "supplier_invoice_items": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplied_product_id",
   "table": "supplier_products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_invoice_id",
   "table": "supplier_invoices",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "supplier_invoices": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "purchase_order_id",
   "table": "purchase_orders",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "supplier_payments": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "invoice_id",
   "table": "supplier_invoices",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "payment_id",
   "table": "payments",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "supplier_products": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "CASCADE"
  }
 ],
 "supplier_quotation_items": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "product_id",
   "table": "products",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "quotation_id",
   "table": "supplier_quotations",
   "to": "id",
   "onDelete": "CASCADE"
  },
  {
   "from": "supplied_product_id",
   "table": "supplier_products",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "supplier_quotations": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "supplier_ratings": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "purchase_order_id",
   "table": "purchase_orders",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "supplier_id",
   "table": "suppliers",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "suppliers": [],
 "usage_counters": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "users": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "vehicle_fuel_logs": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "driver_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "vehicle_id",
   "table": "vehicles",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "vehicle_service_records": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "vehicle_id",
   "table": "vehicles",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "vehicle_service_schedules": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "created_by",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "vehicle_id",
   "table": "vehicles",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "vehicles": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  },
  {
   "from": "driver_id",
   "table": "users",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ],
 "warehouses": [
  {
   "from": "company_id",
   "table": "companies",
   "to": "id",
   "onDelete": "NO ACTION"
  }
 ]
});
